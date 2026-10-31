package executor

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/atm"
	"nextera.local/runner/internal/sandbox"
	"strings"
	"testing"
)

type atmPhase struct {
	*fakeProgramPhase
	observations            []sandbox.ExecObservation
	errs                    []error
	controlBad, controlMode string
	controlCalls            int
}

func (p *atmPhase) ExecCaptured(ctx context.Context, cmd, env []string, input []byte, cap int) (sandbox.ExecObservation, error) {
	if len(cmd) != 1 || cmd[0] != "/workspace/program" {
		p.controlCalls++
		var out, stderr []byte
		var exit int
		var err error
		if len(cmd) > 2 && cmd[0] == "/bin/tar" && cmd[2] == "-xf" {
			p.files = map[string][]byte{}
			reader := tar.NewReader(bytes.NewReader(input))
			for {
				header, e := reader.Next()
				if e == io.EOF {
					break
				}
				if e != nil {
					return sandbox.ExecObservation{}, e
				}
				p.files[header.Name], e = io.ReadAll(reader)
				if e != nil {
					return sandbox.ExecObservation{}, e
				}
			}
		} else {
			out, stderr, exit, err = p.fakeProgramPhase.Exec(ctx, cmd, env, input, cap)
		}
		o := completeATM(string(out), string(stderr))
		o.ExitCode = &exit
		bad := len(cmd) > 0 && ((p.controlBad == "import" && cmd[0] == "/bin/tar" && len(cmd) > 2 && cmd[2] == "-xf") || (p.controlBad == "chmod" && cmd[0] == "/bin/chmod") || (p.controlBad == "resource" && cmd[0] == "/bin/cat") || (p.controlBad == "compile" && cmd[0] == "/bin/sh") || (p.controlBad == "export" && cmd[0] == "/bin/tar" && len(cmd) > 2 && cmd[2] == "-cf"))
		if bad {
			switch p.controlMode {
			case "missing-inspect":
				o.ExitCode = nil
				o.OutputComplete = false
			case "short-write":
				o.TransportWriteComplete = false
			case "half-close":
				o.StdinHalfClosed = false
			default:
				return o, sandbox.ErrInfrastructure
			}
		}
		return o, err
	}
	_, _, _, _ = p.fakeProgramPhase.Exec(ctx, cmd, env, input, cap)
	i := len(p.inputs) - 1
	var err error
	if i < len(p.errs) {
		err = p.errs[i]
	}
	if i >= len(p.observations) {
		return sandbox.ExecObservation{}, sandbox.ErrInfrastructure
	}
	return p.observations[i], err
}

type atmEngine struct {
	compile *atmPhase
	runtime *atmPhase
	creates int
}

func (e *atmEngine) VerifyImage(context.Context, string) error { return nil }
func (e *atmEngine) Create(_ context.Context, _ string, compile bool) (gradingPhase, error) {
	e.creates++
	if compile {
		return e.compile, nil
	}
	return e.runtime, nil
}
func completeATM(out, human string) sandbox.ExecObservation {
	zero := 0
	return sandbox.ExecObservation{Stdout: []byte(out), Stderr: []byte(human), ExitCode: &zero, TransportWriteComplete: true, StdinHalfClosed: true, OutputComplete: true}
}
func TestATMInputOnlyCasesRejectMissingNullAndExpected(t *testing.T) {
	for _, bad := range []string{`[{}]`, `[{"input":null}]`, `[{"input":0}]`, `[{"input":false}]`, `[{"input":{}}]`, `[{"input":"","expected":"PASS"}]`, `[{"input":"","input":"x"}]`} {
		_, err := atmCases(context.Background(), map[string][]byte{"cases/public.json": []byte(bad), "cases/private.json": []byte(`[{"input":""}]`)}, 65536)
		if err == nil {
			t.Fatal("ambiguous/expected case accepted")
		}
	}
	got, err := atmCases(context.Background(), map[string][]byte{"cases/public.json": []byte(`[{"input":""}]`), "cases/private.json": []byte(`[{"input":"0427\r\n4"}]`)}, 65536)
	if err != nil || len(got) != 2 || len(got[0].input) != 0 || string(got[1].input) != "0427\r\n4" {
		t.Fatal("exact input-only bytes changed", err)
	}
	tooMany := []byte("[" + strings.TrimSuffix(strings.Repeat(`{"input":""},`, 6000), ",") + "]")
	if _, err := atmCases(context.Background(), map[string][]byte{"cases/public.json": tooMany, "cases/private.json": tooMany}, 65536); err == nil {
		t.Fatal("whole-pack minimum Report bytes exceeded output budget")
	}
}
func TestATMRealCaptureModelAndAggregateBudgetFakes(t *testing.T) {
	s := programSnapshot()
	s.Contract.Version = 4
	s.Contract.Output = "atm_report_events_v1"
	cases := []atmCase{{"cases/public.json", nil}, {"cases/private.json", []byte("0427\n4")}}
	p := &atmPhase{fakeProgramPhase: &fakeProgramPhase{}, observations: []sandbox.ExecObservation{completeATM("[\"end\",null]\n", "human phrasing"), completeATM("[\"menu\",100]\n[\"end\",100]\n", "different prose")}}
	e := Executor{engine: &atmEngine{runtime: p}}
	evidence, verdict, err := e.executeATM(context.Background(), s, []byte("binary"), cases, map[string]int64{}, atm.Context{CaseCount: 2})
	if err != nil || verdict != "passed" || !evidence.CompleteMatch() || p.closed != 1 || p.caps[1] != 65536-len(p.observations[0].Stdout)-len(p.observations[0].Stderr) || !p.deadlines[0].Equal(p.deadlines[1]) {
		t.Fatal("host capture/model/budget incorrect", verdict, err)
	}
	if len(p.files) != 1 || !bytes.Equal(p.files["program"], []byte("binary")) {
		t.Fatal("hidden model/cases imported")
	}
	data, _ := json.Marshal(Result{Verdict: verdict, ATM: evidence})
	for _, secret := range []string{"human phrasing", "stdinBase64", "caseFile", "Context", "Captures", "caseIndex"} {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatal("private evidence leaked into public Result")
		}
	}
}
func TestATMIncompleteEvidenceAndCleanupNeverGrades(t *testing.T) {
	s := programSnapshot()
	s.Contract.Version = 4
	s.Contract.Output = "atm_report_events_v1"
	for _, mode := range []string{"write", "half", "output", "exit", "infra", "timeout", "stop", "resource-missing"} {
		t.Run(mode, func(t *testing.T) {
			o := completeATM("[\"end\",null]\n", "")
			p := &atmPhase{fakeProgramPhase: &fakeProgramPhase{}, observations: []sandbox.ExecObservation{o}}
			switch mode {
			case "write":
				p.observations[0].TransportWriteComplete = false
			case "half":
				p.observations[0].StdinHalfClosed = false
			case "output":
				p.observations[0].OutputComplete = false
			case "exit":
				p.observations[0].ExitCode = nil
			case "infra":
				p.errs = []error{sandbox.ErrInfrastructure}
			case "timeout":
				p.errs = []error{context.DeadlineExceeded}
			case "stop":
				p.stopErr = sandbox.ErrInfrastructure
			case "resource-missing":
				p.resource = "missing"
			}
			e := Executor{engine: &atmEngine{runtime: p}}
			evidence, verdict, err := e.executeATM(context.Background(), s, nil, []atmCase{{"cases/public.json", nil}}, map[string]int64{}, atm.Context{CaseCount: 1})
			if err == nil || verdict != "" || evidence.CompleteMatch() || p.closed != 1 {
				t.Fatal("incomplete/unknown became grade", verdict, err)
			}
		})
	}
}
func TestATMFalseProjectionIsIndependentOfLearnerPASSAndStderr(t *testing.T) {
	s := programSnapshot()
	s.Contract.Version = 4
	s.Contract.Output = "atm_report_events_v1"
	for _, text := range []string{"PASS\n", "[\"end\",100]\n", "[\"end\",null]\n[\"end\",null]\n"} {
		p := &atmPhase{fakeProgramPhase: &fakeProgramPhase{}, observations: []sandbox.ExecObservation{completeATM(text, "all passed!")}}
		e := Executor{engine: &atmEngine{runtime: p}}
		ev, v, err := e.executeATM(context.Background(), s, nil, []atmCase{{"cases/public.json", nil}}, map[string]int64{}, atm.Context{CaseCount: 1})
		if err != nil || v != "failed" || ev.Captures[0].Assessment != "projection_mismatch" {
			t.Fatal("learner self-report trusted")
		}
	}
}
func TestATMCompilationPreservesRawMainAndProfileGate(t *testing.T) {
	s := programSnapshot()
	s.Contract.Version = 4
	s.Contract.Output = "atm_report_events_v1"
	source := []byte("package main\r\nfunc main(){}\r\n")
	plan, _, err := compilationPlan(s, source)
	if err != nil || len(plan) != 1 || !bytes.Equal(plan["main.go"], source) {
		t.Fatal("ABI4 source repackaged")
	}
	engine := &atmEngine{}
	e := Executor{engine: engine}
	r := e.evaluateLoaded(context.Background(), s, source, nil, *s.Contract)
	if r.Verdict != "system_error" || r.ATM != nil || engine.creates != 0 {
		t.Fatal("missing authoritative context executed")
	}
	_ = artifact.ATMSemanticProfileDigest
}

func TestATMCompleteLoadedPipelineBindsContextSourceAndRawProgram(t *testing.T) {
	s := programSnapshot()
	s.Contract.Version = 4
	s.Contract.Item = "week1-atm"
	s.Contract.Output = "atm_report_events_v1"
	s.PackID = "atm-v1"
	s.SemanticProfileDigest = json.RawMessage(`"` + atm.SemanticProfileDigest + `"`)
	id := "11111111-1111-4111-8111-111111111111"
	h := strings.Repeat("a", 64)
	source := []byte("package main\r\nfunc main(){}\r\n")
	s.VerifiedJob = id
	s.VerifiedJudgeAttempt = id
	s.VerifiedWorker = id
	s.VerifiedGeneration = 1
	s.VerifiedDigest = h
	s.CurriculumID = id
	s.Cohort = id
	s.Submission = id
	s.SpecDigest = h
	s.Node = "week1-atm"
	s.Digest = h
	s.Runner = "sha256:" + h
	s.Source.Digest = atm.SHA(source)
	resource, _ := atm.ResourceDigest(s.Environment)
	binding := atm.Context{Version: 1, JobID: id, JudgeAttemptID: id, WorkerID: id, Generation: "1", SubmissionID: id, RaidAttemptID: id, TeamID: id, CohortID: id, CurriculumVersionID: id, NodeKey: s.Node, SourceSHA256: s.Source.Digest, EvaluationSnapshotDigest: h, EvaluationSpecDigest: h, DefinitionDigest: h, TestPackID: s.PackID, TestPackDigest: h, SemanticProfileDigest: atm.SemanticProfileDigest, RunnerImageDigest: s.Runner, ResourcePolicyDigest: resource, ModelID: atm.ModelID, CaseCount: 2}
	binding.ContextDigest, _ = binding.Digest()
	files := map[string][]byte{"cases/public.json": []byte(`[{"input":""}]`), "cases/private.json": []byte(`[{"input":"0427\n4"}]`)}
	phase := &atmPhase{fakeProgramPhase: &fakeProgramPhase{}, observations: []sandbox.ExecObservation{completeATM("[\"end\",null]\n", "instructions one"), completeATM("[\"menu\",100]\n[\"end\",100]\n", "different human wording")}}
	engine := &atmEngine{compile: &atmPhase{fakeProgramPhase: &fakeProgramPhase{}}, runtime: phase}
	e := Executor{ATMContext: &binding, engine: engine}
	r := e.evaluateLoaded(context.Background(), s, source, files, *s.Contract)
	if r.Verdict != "passed" || r.ATM == nil || !r.ATM.CompleteMatch() || engine.creates != 2 || !bytes.Equal(engine.compile.files["main.go"], source) || len(engine.compile.files) != 1 || engine.compile.closed != 1 || phase.closed != 1 {
		t.Fatal("actual loaded evaluator did not retain genuine fake host observations", r.Verdict, r.Code)
	}
	before := engine.creates
	r = e.evaluateLoaded(context.Background(), s, []byte("different source"), files, *s.Contract)
	if r.Verdict != "system_error" || engine.creates != before {
		t.Fatal("different source ran against context")
	}
	engine.compile.build.exit = 2
	r = e.evaluateLoaded(context.Background(), s, source, files, *s.Contract)
	if r.Verdict != "system_error" || r.ATM != nil {
		t.Fatal("compiler nonzero invented functional evidence")
	}
}

func TestATMCapturedControlsCannotUsePlausibleLegacySuccess(t *testing.T) {
	s := programSnapshot()
	s.Contract.Version = 4
	s.Contract.Output = "atm_report_events_v1"
	for _, command := range []string{"import", "chmod", "resource"} {
		for _, mode := range []string{"missing-inspect", "duplicate-inspect", "trailing-inspect", "short-write", "half-close"} {
			t.Run(command+"/"+mode, func(t *testing.T) {
				p := &atmPhase{fakeProgramPhase: &fakeProgramPhase{}, observations: []sandbox.ExecObservation{completeATM("[\"end\",null]\n", "")}, controlBad: command, controlMode: mode}
				e := Executor{engine: &atmEngine{runtime: p}}
				evidence, v, err := e.executeATM(context.Background(), s, nil, []atmCase{{"cases/public.json", nil}}, map[string]int64{}, atm.Context{CaseCount: 1})
				if err == nil || v != "" || evidence.CompleteMatch() || p.closed != 1 {
					t.Fatal("legacy-looking control output granted grade")
				}
			})
		}
	}
	for _, command := range []string{"import", "compile", "resource", "export"} {
		for _, mode := range []string{"missing-inspect", "duplicate-inspect", "trailing-inspect", "short-write", "half-close"} {
			t.Run("compiler/"+command+"/"+mode, func(t *testing.T) {
				p := &atmPhase{fakeProgramPhase: &fakeProgramPhase{}, controlBad: command, controlMode: mode}
				e := Executor{engine: &atmEngine{compile: p}}
				program, err := e.compileATM(context.Background(), s, []byte("package main\nfunc main(){}\n"), map[string]int64{})
				if err == nil || program != nil || p.closed != 1 {
					t.Fatal("ambiguous compiler control released a binary")
				}
			})
		}
	}
}
