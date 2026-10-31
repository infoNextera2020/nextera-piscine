package executor

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/atm"
	"nextera.local/runner/internal/protocol"
	"nextera.local/runner/internal/sandbox"
	"time"
	"unicode/utf8"
)

type atmCase struct {
	file  string
	input []byte
}

func atmCases(ctx context.Context, files map[string][]byte, outputBudget int) ([]atmCase, error) {
	var result []atmCase
	remaining := outputBudget
	for _, name := range []string{"cases/public.json", "cases/private.json"} {
		var rows []struct {
			Input json.RawMessage `json:"input"`
		}
		data := files[name]
		if !utf8.Valid(data) || artifact.Strict(data, &rows) != nil || len(rows) == 0 || len(rows) > 10000 {
			return nil, atm.ErrUnavailable
		}
		for _, row := range rows {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			var input string
			if len(row.Input) < 2 || row.Input[0] != '"' || json.Unmarshal(row.Input, &input) != nil || !utf8.ValidString(input) {
				return nil, atm.ErrUnavailable
			}
			expected, err := atm.ExpectedContext(ctx, []byte(input), remaining)
			if err != nil {
				return nil, atm.ErrUnavailable
			}
			remaining -= atm.OutputBytes(expected)
			result = append(result, atmCase{name, []byte(input)})
		}
	}
	return result, nil
}

type capturedPhase interface {
	ExecCaptured(context.Context, []string, []string, []byte, int) (sandbox.ExecObservation, error)
}

// This adapter is ABI4-only. Even control commands with plausible stdout need
// positive transport and unambiguous terminal acknowledgments. Legacy Exec and
// grading helpers remain unchanged for every other ABI.
type atmControl struct {
	gradingPhase
	capture capturedPhase
}

func (c atmControl) Exec(ctx context.Context, cmd, env []string, input []byte, limit int) ([]byte, []byte, int, error) {
	o, err := c.capture.ExecCaptured(ctx, cmd, env, bytes.Clone(input), limit)
	if err != nil || !o.TransportWriteComplete || !o.StdinHalfClosed || !o.OutputComplete || o.ExitCode == nil || *o.ExitCode < 0 || *o.ExitCode > 255 {
		return nil, nil, 0, sandbox.ErrInfrastructure
	}
	return bytes.Clone(o.Stdout), bytes.Clone(o.Stderr), *o.ExitCode, nil
}
func (c atmControl) Import(ctx context.Context, files map[string][]byte) error {
	raw, err := sandbox.Archive(files)
	if err != nil {
		return sandbox.ErrInfrastructure
	}
	_, stderr, exit, err := c.Exec(ctx, []string{"/bin/tar", "--no-same-owner", "-xf", "-", "-C", "/workspace"}, nil, raw, 65536)
	if err != nil || exit != 0 || len(stderr) != 0 {
		return sandbox.ErrInfrastructure
	}
	return nil
}
func (e Executor) compileATM(ctx context.Context, s protocol.Snapshot, source []byte, metrics map[string]int64) (program []byte, failure error) {
	files, command, err := compilationPlan(s, bytes.Clone(source))
	if err != nil {
		return nil, sandbox.ErrInfrastructure
	}
	phase, cancel := context.WithTimeout(ctx, time.Duration(s.Resources.Compilation.Timeout)*time.Millisecond)
	defer cancel()
	started := time.Now()
	defer func() { metrics["compilation_ms"] = time.Since(started).Milliseconds() }()
	c, err := e.runtimeEngine().Create(phase, s.Sandbox, true)
	if err != nil {
		return nil, sandbox.ErrInfrastructure
	}
	defer func() {
		if stopGradingPhase(c) != nil {
			program, failure = nil, sandbox.ErrInfrastructure
		}
	}()
	capture, ok := c.(capturedPhase)
	if !ok {
		return nil, sandbox.ErrInfrastructure
	}
	control := atmControl{c, capture}
	if control.Import(phase, files) != nil {
		return nil, sandbox.ErrInfrastructure
	}
	_, _, exit, err := control.Exec(phase, command, []string{"GOMEMLIMIT=384MiB"}, nil, 65536)
	// A compiler nonzero/timeout has no approved certified-failure report here.
	if err != nil || exit != 0 || phase.Err() != nil {
		return nil, sandbox.ErrInfrastructure
	}
	if programResources(phase, control) != nil {
		return nil, sandbox.ErrInfrastructure
	}
	raw, stderr, exit, err := control.Exec(phase, []string{"/bin/tar", "--format=ustar", "-cf", "-", "-C", "/workspace", "program"}, nil, nil, 8<<20)
	if err != nil || exit != 0 || len(stderr) != 0 || phase.Err() != nil {
		return nil, sandbox.ErrInfrastructure
	}
	program, err = sandbox.Compiled(raw)
	if err != nil {
		return nil, sandbox.ErrInfrastructure
	}
	metrics["compiled_bytes"] = int64(len(program))
	return program, nil
}

func (e Executor) evaluateATM(ctx context.Context, s protocol.Snapshot, source []byte, files map[string][]byte) Result {
	if e.ATMContext == nil || !e.ATMContext.Bound(s) || atm.SHA(source) != s.Source.Digest {
		return infrastructure("ATM_EVIDENCE_UNAVAILABLE")
	}
	cases, err := atmCases(ctx, files, s.Resources.Execution.Output)
	if err != nil || len(cases) != e.ATMContext.CaseCount {
		return infrastructure("ATM_EVIDENCE_UNAVAILABLE")
	}
	if _, exists := files[artifact.ScoringManifestPath]; exists {
		return infrastructure("ATM_EVIDENCE_UNAVAILABLE")
	}
	if e.runtimeEngine().VerifyImage(ctx, s.Sandbox) != nil {
		return infrastructure("ARTIFACT_UNAVAILABLE")
	}
	metrics := map[string]int64{}
	program, err := e.compileATM(ctx, s, source, metrics)
	// The complete-observations profile does not turn compiler/resource/infra
	// rejection into a fabricated functional zero. No successful runtime exists.
	if err != nil {
		return infrastructure("ATM_CAPTURE_UNAVAILABLE")
	}
	evidence, verdict, err := e.executeATM(ctx, s, program, cases, metrics, *e.ATMContext)
	if err != nil {
		return Result{Verdict: "system_error", Code: "ATM_CAPTURE_UNAVAILABLE", Metrics: metrics, ATM: evidence}
	}
	return Result{Verdict: verdict, Metrics: metrics, ATM: evidence}
}

func (e Executor) executeATM(ctx context.Context, s protocol.Snapshot, program []byte, cases []atmCase, metrics map[string]int64, binding atm.Context) (evidence *atm.Evidence, verdict string, failure error) {
	evidence = &atm.Evidence{Context: binding, Captures: []atm.Capture{}}
	phase, cancel := context.WithTimeout(ctx, time.Duration(s.Resources.Execution.Timeout)*time.Millisecond)
	defer cancel()
	started := time.Now()
	defer func() { metrics["execution_ms"] = time.Since(started).Milliseconds() }()
	c, err := e.runtimeEngine().Create(phase, s.Sandbox, false)
	if err != nil {
		return evidence, "", sandbox.ErrInfrastructure
	}
	defer func() {
		if stopGradingPhase(c) != nil {
			verdict, failure = "", sandbox.ErrInfrastructure
			return
		}
		evidence.StopVerified = true
	}()
	capture, ok := c.(capturedPhase)
	if !ok {
		return evidence, "", sandbox.ErrInfrastructure
	}
	control := atmControl{c, capture}
	if control.Import(phase, map[string][]byte{"program": bytes.Clone(program)}) != nil {
		return evidence, "", sandbox.ErrInfrastructure
	}
	if _, stderr, exit, err := control.Exec(phase, []string{"/bin/chmod", "500", "/workspace/program"}, nil, nil, 65536); err != nil || exit != 0 || len(stderr) != 0 {
		return evidence, "", sandbox.ErrInfrastructure
	}
	remaining := s.Resources.Execution.Output
	for index, item := range cases {
		if phase.Err() != nil {
			return evidence, "", sandbox.ErrInfrastructure
		}
		observed, execErr := capture.ExecCaptured(phase, []string{"/workspace/program"}, nil, bytes.Clone(item.input), remaining)
		entry := atm.Capture{CaseFile: item.file, CaseIndex: index, InputSHA256: atm.SHA(item.input), StdinBase64: base64.StdEncoding.EncodeToString(item.input), StdoutBase64: base64.StdEncoding.EncodeToString(observed.Stdout), StderrBase64: base64.StdEncoding.EncodeToString(observed.Stderr), TransportWriteComplete: observed.TransportWriteComplete, StdinHalfClosed: observed.StdinHalfClosed, OutputComplete: observed.OutputComplete, Termination: "unknown", Assessment: "capture_unavailable"}
		if observed.ExitCode != nil {
			n := *observed.ExitCode
			entry.ExitCode = &n
			entry.Termination = "exited"
		}
		remaining -= len(observed.Stdout) + len(observed.Stderr)
		complete := execErr == nil && remaining >= 0 && observed.TransportWriteComplete && observed.StdinHalfClosed && observed.OutputComplete && entry.ExitCode != nil && *entry.ExitCode >= 0 && *entry.ExitCode <= 255
		if !complete {
			if errors.Is(execErr, context.DeadlineExceeded) || errors.Is(phase.Err(), context.DeadlineExceeded) {
				entry.Termination = "timed_out"
				entry.ExitCode = nil
				entry.OutputComplete = false
			}
			entry.Assessment = "incomplete_observation"
			evidence.Captures = append(evidence.Captures, entry)
			return evidence, "", sandbox.ErrInfrastructure
		}
		if ctx.Err() != nil {
			return evidence, "", sandbox.ErrInfrastructure
		}
		resourceErr := programResources(phase, control)
		if ctx.Err() != nil || phase.Err() != nil {
			evidence.Captures = append(evidence.Captures, entry)
			return evidence, "", sandbox.ErrInfrastructure
		}
		if resourceErr != nil && !errors.Is(resourceErr, errProgramResources) {
			evidence.Captures = append(evidence.Captures, entry)
			return evidence, "", sandbox.ErrInfrastructure
		}
		if resourceErr != nil || *entry.ExitCode != 0 {
			entry.Assessment = "execution_not_clean"
			evidence.Captures = append(evidence.Captures, entry)
			return evidence, "runtime_error", nil
		}
		matched, modelErr := atm.MatchContext(phase, item.input, observed.Stdout, s.Resources.Execution.Output)
		if ctx.Err() != nil || phase.Err() != nil {
			evidence.Captures = append(evidence.Captures, entry)
			return evidence, "", sandbox.ErrInfrastructure
		}
		if modelErr != nil && errors.Is(modelErr, atm.ErrInput) {
			evidence.Captures = append(evidence.Captures, entry)
			return evidence, "", sandbox.ErrInfrastructure
		}
		entry.Assessment = "projection_mismatch"
		if modelErr == nil && matched {
			entry.Assessment = "observations_match"
		}
		evidence.Captures = append(evidence.Captures, entry)
		if entry.Assessment != "observations_match" {
			return evidence, "failed", nil
		}
	}
	return evidence, "passed", nil
}
