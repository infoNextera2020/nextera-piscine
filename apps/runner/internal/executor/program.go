package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"go/parser"
	"go/token"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/protocol"
	"nextera.local/runner/internal/sandbox"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var errProgramSource = errors.New("PROGRAM_SOURCE_INVALID")

// No pack harness, oracle or expected value is imported into either phase.
// The v1 build command and source bytes are retained exactly.
func compilationPlan(s protocol.Snapshot, source []byte) (map[string][]byte, []string, error) {
	c, err := artifact.ContractFor(s.PackID, s.Contract)
	if err != nil {
		return nil, nil, err
	}
	command := "cp -as /opt/go-cache /workspace/cache && exec go build -trimpath -buildvcs=false -p=1 -ldflags=-buildid= -o /workspace/program "
	if c.Version == 2 {
		// A non-main package can make go build emit an archive with exit zero.
		// Classify that learner input before the binary-transfer integrity check,
		// preserving exact source bytes and leaving all later syntax to Go build.
		parsed, parseErr := parser.ParseFile(token.NewFileSet(), "main.go", source, parser.PackageClauseOnly)
		if parseErr != nil || parsed == nil || parsed.Name == nil || parsed.Name.Name != "main" {
			return nil, nil, errProgramSource
		}
		return map[string][]byte{"main.go": source}, []string{"/bin/sh", "-c", command + "/workspace/main.go"}, nil
	}
	return map[string][]byte{"solution.go": source, "transport.go": adapterFor(c)}, []string{"/bin/sh", "-c", command + "/workspace/solution.go /workspace/transport.go"}, nil
}

// v2 is an explicitly authored, digest-bound UTF-8 stdin/exact stdout ABI.
// One aggregate execution deadline and output budget cover every case, not a
// fresh allowance per case. The original engine's no-network/non-root/tempfs
// enforcement remains unchanged. No multi-file or interactive protocol exists.
func (e Executor) executeProgram(ctx context.Context, s protocol.Snapshot, program []byte, inputs []json.RawMessage, expected []string, metrics map[string]int64) (string, error) {
	contract, err := artifact.ContractFor(s.PackID, s.Contract)
	if err != nil || contract.Version != 2 || len(inputs) == 0 || len(inputs) != len(expected) || !s.Environment.Valid() {
		return "", artifact.ErrInvalid
	}
	decoded := make([]string, len(inputs))
	for i, input := range inputs {
		if !utf8.Valid(input) || len(input) < 2 || input[0] != '"' || json.Unmarshal(input, &decoded[i]) != nil || !utf8.ValidString(expected[i]) {
			return "", artifact.ErrInvalid
		}
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	c, err := e.runtimeEngine().Create(ctx, s.Sandbox, false)
	if err != nil {
		return "", err
	}
	defer c.Close()
	if c.Import(ctx, map[string][]byte{"program": program}) != nil {
		return "", sandbox.ErrInfrastructure
	}
	if _, _, exit, err := c.Exec(ctx, []string{"/bin/chmod", "500", "/workspace/program"}, nil, nil, 65536); err != nil || exit != 0 {
		return "", sandbox.ErrInfrastructure
	}
	phase, cancel := context.WithTimeout(ctx, time.Duration(s.Resources.Execution.Timeout)*time.Millisecond)
	defer cancel()
	started := time.Now()
	defer func() { metrics["execution_ms"] = time.Since(started).Milliseconds() }()
	remaining := s.Resources.Execution.Output
	for i, input := range decoded {
		out, stderr, exit, execErr := c.Exec(phase, []string{"/workspace/program"}, nil, []byte(input), remaining)
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if errors.Is(execErr, context.DeadlineExceeded) || errors.Is(phase.Err(), context.DeadlineExceeded) {
			return "timeout", nil
		}
		if errors.Is(execErr, sandbox.ErrOutput) {
			return "runtime_error", nil
		}
		if execErr != nil {
			return "", sandbox.ErrInfrastructure
		}
		remaining -= len(out) + len(stderr)
		if remaining < 0 {
			return "runtime_error", nil
		}
		if exit != 0 || len(stderr) != 0 {
			return "runtime_error", nil
		}
		if resourceErr := programResources(phase, c); resourceErr != nil {
			// Lease/operator cancellation is infrastructure uncertainty, including
			// a parent deadline expiring during a trusted resource inspection.
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			if errors.Is(phase.Err(), context.DeadlineExceeded) {
				return "timeout", nil
			}
			if errors.Is(resourceErr, errProgramResources) {
				return "runtime_error", nil
			}
			return "", sandbox.ErrInfrastructure
		}
		// Do not trim, normalize CRLF, parse JSON or tolerate an extra newline.
		if !bytes.Equal(out, []byte(expected[i])) {
			return "failed", nil
		}
	}
	return "passed", nil
}

var errProgramResources = errors.New("PROGRAM_RESOURCE_LIMIT")

func programResources(ctx context.Context, c gradingPhase) error {
	for _, pair := range [][2]string{{"pids", "max"}, {"memory", "oom_kill"}} {
		raw, stderr, code, err := c.Exec(ctx, []string{"/bin/cat", "/sys/fs/cgroup/" + pair[0] + ".events"}, nil, nil, 65536)
		if err != nil || code != 0 || len(stderr) != 0 {
			return sandbox.ErrInfrastructure
		}
		seen := false
		for _, line := range strings.Split(string(raw), "\n") {
			fields := strings.Fields(line)
			if len(fields) == 2 && fields[0] == pair[1] {
				if seen {
					return sandbox.ErrInfrastructure
				}
				seen = true
				n, err := strconv.ParseUint(fields[1], 10, 64)
				if err != nil {
					return sandbox.ErrInfrastructure
				}
				if n != 0 {
					return errProgramResources
				}
			}
		}
		if !seen {
			return sandbox.ErrInfrastructure
		}
	}
	raw, stderr, code, err := c.Exec(ctx, []string{"/usr/bin/stat", "-f", "-c", "%a %d", "/workspace", "/tmp", "/dev/shm"}, nil, nil, 65536)
	if err != nil || code != 0 || len(stderr) != 0 {
		return sandbox.ErrInfrastructure
	}
	fields := strings.Fields(string(raw))
	if len(fields) != 6 {
		return sandbox.ErrInfrastructure
	}
	for _, field := range fields {
		n, err := strconv.ParseInt(field, 10, 64)
		if err != nil || n < 0 {
			return sandbox.ErrInfrastructure
		}
		if n == 0 {
			return errProgramResources
		}
	}
	return nil
}
