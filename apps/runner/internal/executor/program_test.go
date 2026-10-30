package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/protocol"
	"nextera.local/runner/internal/sandbox"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func programSnapshot() protocol.Snapshot {
	return protocol.Snapshot{PackID: "greeting-program-v2", Entry: artifact.Entry{Contract: &artifact.ExecutionContract{Version: 2, Item: "greeting-card", File: "main.go", Input: "stdin_utf8", Output: "stdout_utf8_exact"}, Environment: artifact.Environment{
		Sandbox: "sha256:" + strings.Repeat("c", 64), Toolchain: artifact.Toolchain, Platform: artifact.Platform, Flags: []string{"-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid="}, Dependencies: "offline", Profile: artifact.Profile, Resources: artifact.PilotResources(), Protocol: 1, Snapshot: 1, Generation: artifact.Generation{Mode: "static"},
	}}}
}

type programResponse struct {
	out, stderr []byte
	exit        int
	err         error
}
type fakeProgramPhase struct {
	files          map[string][]byte
	commands       [][]string
	inputs         [][]byte
	caps           []int
	deadlines      []time.Time
	responses      []programResponse
	build          programResponse
	compile        bool
	closed         int
	stopErr        error
	stopDeadline   time.Time
	stopContextErr error
	resource       string
	onProbe        func()
}

func (p *fakeProgramPhase) Import(_ context.Context, files map[string][]byte) error {
	p.files = files
	return nil
}
func (p *fakeProgramPhase) CloseVerified(ctx context.Context) error {
	p.closed++
	p.stopDeadline, _ = ctx.Deadline()
	p.stopContextErr = ctx.Err()
	return p.stopErr
}
func (p *fakeProgramPhase) Exec(ctx context.Context, command, env []string, input []byte, limit int) ([]byte, []byte, int, error) {
	p.commands = append(p.commands, command)
	if len(command) > 0 && command[0] == "/bin/sh" {
		return p.build.out, p.build.stderr, p.build.exit, p.build.err
	}
	if len(command) > 0 && command[0] == "/bin/tar" {
		raw, _ := sandbox.Archive(map[string][]byte{"program": {0x7f, 'E', 'L', 'F', 1}})
		return raw, nil, 0, nil
	}
	if len(command) == 1 && command[0] == "/workspace/program" {
		p.inputs = append(p.inputs, append([]byte(nil), input...))
		p.caps = append(p.caps, limit)
		d, _ := ctx.Deadline()
		p.deadlines = append(p.deadlines, d)
		n := len(p.inputs) - 1
		if n >= len(p.responses) {
			return nil, nil, 0, errors.New("unexpected extra execution")
		}
		r := p.responses[n]
		return r.out, r.stderr, r.exit, r.err
	}
	if len(command) > 1 && command[0] == "/bin/cat" {
		if p.onProbe != nil {
			p.onProbe()
			return nil, nil, 0, sandbox.ErrInfrastructure
		}
		if p.resource == "unavailable" {
			return nil, nil, 0, sandbox.ErrInfrastructure
		}
		if strings.Contains(command[1], "pids") {
			if p.resource == "pids" {
				return []byte("max 1\n"), nil, 0, nil
			}
			return []byte("max 0\n"), nil, 0, nil
		}
		if p.resource == "oom" {
			return []byte("oom_kill 1\n"), nil, 0, nil
		}
		if p.resource == "missing" {
			return []byte("oom 0\n"), nil, 0, nil
		}
		return []byte("oom_kill 0\n"), nil, 0, nil
	}
	if len(command) > 0 && command[0] == "/usr/bin/stat" {
		return []byte("10 10 10 10 10 10"), nil, 0, nil
	}
	return nil, nil, 0, nil
}

type fakeProgramEngine struct {
	phase   *fakeProgramPhase
	creates int
	compile bool
}

func (e *fakeProgramEngine) VerifyImage(context.Context, string) error { return nil }
func (e *fakeProgramEngine) Create(_ context.Context, _ string, compile bool) (gradingPhase, error) {
	e.creates++
	e.compile = compile
	return e.phase, nil
}
func rawInputs(values ...string) []json.RawMessage {
	out := make([]json.RawMessage, len(values))
	for i, v := range values {
		out[i], _ = json.Marshal(v)
	}
	return out
}

func TestProgramCompilationPreservesBytesAndImportsNoTransportOrOracle(t *testing.T) {
	source := []byte("package main\r\nimport \"fmt\"\r\nfunc main(){fmt.Println(\"Hello\")}\r\n")
	plan, command, err := compilationPlan(programSnapshot(), source)
	if err != nil || len(plan) != 1 || !bytes.Equal(plan["main.go"], source) {
		t.Fatal("source changed or extra compiler file", err)
	}
	if !strings.HasSuffix(command[2], " /workspace/main.go") || strings.Contains(command[2], "transport.go") {
		t.Fatal("program build uses a function transport")
	}
	p := &fakeProgramPhase{compile: true}
	engine := &fakeProgramEngine{phase: p}
	e := Executor{engine: engine}
	program, verdict, err := e.compile(context.Background(), programSnapshot(), source, map[string]int64{})
	if err != nil || verdict != "" || len(program) != 5 || !engine.compile || p.closed != 1 || !reflect.DeepEqual(p.files, plan) {
		t.Fatal("program compile lifecycle incorrect", verdict, err)
	}
	legacy := programSnapshot()
	legacy.PackID = "hello-go-v1"
	legacy.Contract = nil
	files, cmd, err := compilationPlan(legacy, source)
	if err != nil || len(files) != 2 || !bytes.Equal(files["solution.go"], source) || string(files["transport.go"]) != string(adapter("hello-go-v1")) || cmd[2] != "cp -as /opt/go-cache /workspace/cache && exec go build -trimpath -buildvcs=false -p=1 -ldflags=-buildid= -o /workspace/program /workspace/solution.go /workspace/transport.go" {
		t.Fatal("legacy compile bytes or command changed")
	}
}

func TestProgramTrustedCasesAndExactOutput(t *testing.T) {
	s := programSnapshot()
	c := *s.Contract
	data := []byte(`[{"input":"","expected":"Hello, Go learner!\nI can run a program.\n"}]`)
	inputs, expected, err := casesFor(map[string][]byte{"cases/public.json": data, "cases/private.json": data}, c)
	if err != nil || len(inputs) != 2 {
		t.Fatal("explicit stdin cases rejected", err)
	}
	for _, actual := range []string{"Hello, Go learner!\nI can run a program.\n", "Hello, Go learner!\nI can run a program.", "Hello, Go learner!\r\nI can run a program.\r\n", " Hello, Go learner!\nI can run a program.\n"} {
		p := &fakeProgramPhase{responses: []programResponse{{out: []byte(actual)}, {out: []byte(actual)}}}
		e := Executor{engine: &fakeProgramEngine{phase: p}}
		verdict, err := e.execute(context.Background(), s, []byte("bounded-compiled-fixture"), inputs, expected, map[string]int64{})
		want := "failed"
		if actual == expected[0] {
			want = "passed"
		}
		if err != nil || verdict != want || p.closed != 1 {
			t.Fatal("byte-exact output or cleanup incorrect", verdict, err)
		}
		if len(p.files) != 1 || string(p.files["program"]) != "bounded-compiled-fixture" {
			t.Fatal("expected cases/oracle imported into runtime")
		}
		for _, input := range p.inputs {
			if len(input) != 0 {
				t.Fatal("stdin transformed or expected value leaked")
			}
		}
	}
	for _, bad := range []string{`[{"input":0,"expected":"x"}]`, `[{"input":null,"expected":"x"}]`, `[{"input":"a","expected":null}]`} {
		if _, _, err := casesFor(map[string][]byte{"cases/public.json": []byte(bad), "cases/private.json": []byte(bad)}, c); err == nil {
			t.Fatal("program accepted non-text/missing case")
		}
	}
}

func TestProgramAggregateBudgetAndStdinBytes(t *testing.T) {
	s := programSnapshot()
	p := &fakeProgramPhase{responses: []programResponse{{out: []byte("one\n")}, {out: []byte("two\n")}}}
	e := Executor{engine: &fakeProgramEngine{phase: p}}
	verdict, err := e.execute(context.Background(), s, nil, rawInputs(" first\r\n", "second\n"), []string{"one\n", "two\n"}, map[string]int64{})
	if err != nil || verdict != "passed" || !bytes.Equal(p.inputs[0], []byte(" first\r\n")) || !bytes.Equal(p.inputs[1], []byte("second\n")) || p.caps[1] != s.Resources.Execution.Output-4 || p.deadlines[0].IsZero() || !p.deadlines[0].Equal(p.deadlines[1]) {
		t.Fatal("aggregate allowance renewed or stdin changed", verdict, err, p.caps)
	}
	p = &fakeProgramPhase{responses: []programResponse{{out: bytes.Repeat([]byte("x"), s.Resources.Execution.Output)}, {out: []byte("x")}}}
	e.engine = &fakeProgramEngine{phase: p}
	verdict, err = e.execute(context.Background(), s, nil, rawInputs("", ""), []string{strings.Repeat("x", s.Resources.Execution.Output), "x"}, map[string]int64{})
	if err != nil || verdict != "runtime_error" || p.caps[1] != 0 {
		t.Fatal("aggregate output cap renewed", verdict, err, p.caps)
	}
}

func TestProgramFailuresRemainDistinctAndClosePhase(t *testing.T) {
	for _, test := range []struct {
		name           string
		r              programResponse
		resource, want string
		infra          bool
	}{
		{"exit", programResponse{exit: 1}, "", "runtime_error", false},
		{"stderr", programResponse{stderr: []byte("private diagnostic")}, "", "runtime_error", false},
		{"timeout", programResponse{err: context.DeadlineExceeded}, "", "timeout", false},
		{"output", programResponse{err: sandbox.ErrOutput}, "", "runtime_error", false},
		{"transport", programResponse{err: sandbox.ErrInfrastructure}, "", "", true},
		{"oom", programResponse{}, "oom", "runtime_error", false},
		{"pids", programResponse{}, "pids", "runtime_error", false},
		{"missing-counter", programResponse{}, "missing", "", true},
		{"inspection", programResponse{}, "unavailable", "", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := &fakeProgramPhase{responses: []programResponse{test.r}, resource: test.resource}
			e := Executor{engine: &fakeProgramEngine{phase: p}}
			v, err := e.execute(context.Background(), programSnapshot(), nil, rawInputs(""), []string{""}, map[string]int64{})
			if v != test.want || (err != nil) != test.infra || p.closed != 1 {
				t.Fatal("classification/cleanup changed", v, err)
			}
		})
	}
	for _, r := range []programResponse{{exit: 2}, {err: context.DeadlineExceeded}, {err: sandbox.ErrOutput}, {err: sandbox.ErrInfrastructure}} {
		p := &fakeProgramPhase{compile: true, build: r}
		e := Executor{engine: &fakeProgramEngine{phase: p}}
		_, v, err := e.compile(context.Background(), programSnapshot(), []byte("package main\nfunc main() {}\n"), map[string]int64{})
		if (r.err == sandbox.ErrInfrastructure && (err == nil || v != "")) || (r.err != sandbox.ErrInfrastructure && (err != nil || v != "compile_error")) || p.closed != 1 {
			t.Fatal("compile/system failure distinction changed", v, err)
		}
	}
}

func TestProgramCancelledBeforeCreationDoesNotTouchEngine(t *testing.T) {
	p := &fakeProgramPhase{}
	engine := &fakeProgramEngine{phase: p}
	e := Executor{engine: engine}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	v, err := e.execute(ctx, programSnapshot(), nil, rawInputs(""), []string{""}, map[string]int64{})
	if v != "" || !errors.Is(err, context.Canceled) || engine.creates != 0 {
		t.Fatal("cancelled execution touched sandbox", v, err, engine.creates)
	}
}

func TestLegacyFunctionExecutionKeepsJSONArrayTransport(t *testing.T) {
	s := programSnapshot()
	s.PackID = "hello-go-v1"
	s.Contract = nil
	p := &fakeProgramPhase{responses: []programResponse{{out: []byte(`["ok"]`)}}}
	e := Executor{engine: &fakeProgramEngine{phase: p}}
	inputs := rawInputs("raw\n")
	verdict, err := e.execute(context.Background(), s, []byte("compiled fixture"), inputs, []string{"ok"}, map[string]int64{})
	want, _ := json.Marshal(inputs)
	if err != nil || verdict != "passed" || len(p.inputs) != 1 || !bytes.Equal(p.inputs[0], want) || p.closed != 1 {
		t.Fatal("legacy JSON-array ABI changed", verdict, err, p.inputs)
	}
}

func TestProgramNonMainSourceIsCompileErrorBeforeEngine(t *testing.T) {
	for _, source := range []string{"package library\nfunc F() {}\n", "// comment\npackage utilities\n", "not a Go package"} {
		engine := &fakeProgramEngine{phase: &fakeProgramPhase{}}
		e := Executor{engine: engine}
		_, verdict, err := e.compile(context.Background(), programSnapshot(), []byte(source), map[string]int64{})
		if err != nil || verdict != "compile_error" || engine.creates != 0 {
			t.Fatal("non-main source misclassified as infrastructure or touched engine", verdict, err, engine.creates)
		}
	}
}

type probeExpiredContext struct {
	context.Context
	done    chan struct{}
	expired atomic.Bool
	failure error
}

func (c *probeExpiredContext) Done() <-chan struct{} { return c.done }
func (c *probeExpiredContext) Err() error {
	if c.expired.Load() {
		return c.failure
	}
	return nil
}
func (c *probeExpiredContext) expire() {
	if c.expired.CompareAndSwap(false, true) {
		close(c.done)
	}
}

func TestProgramParentExpiryDuringResourceProbeIsNotLearnerTimeout(t *testing.T) {
	for _, failure := range []error{context.Canceled, context.DeadlineExceeded} {
		ctx := &probeExpiredContext{Context: context.Background(), done: make(chan struct{}), failure: failure}
		p := &fakeProgramPhase{responses: []programResponse{{}}, onProbe: ctx.expire}
		e := Executor{engine: &fakeProgramEngine{phase: p}}
		verdict, err := e.execute(ctx, programSnapshot(), nil, rawInputs(""), []string{""}, map[string]int64{})
		if verdict != "" || !errors.Is(err, failure) || p.closed != 1 {
			t.Fatal("parent expiry became a learner outcome", verdict, err, p.closed)
		}
	}
}

func TestUnconfirmedGradingStopDiscardsAllLearnerOutcomes(t *testing.T) {
	for _, version := range []int{1, 2} {
		for _, learner := range []string{"passed", "failed", "runtime_error", "timeout"} {
			s := programSnapshot()
			if version == 1 {
				s.PackID = "hello-go-v1"
				s.Contract = nil
			}
			r := programResponse{out: []byte("ok")}
			if version == 1 {
				r.out = []byte(`["ok"]`)
			}
			if learner == "failed" {
				r.out = []byte("wrong")
			}
			if learner == "runtime_error" {
				r.exit = 1
			}
			if learner == "timeout" {
				r.err = context.DeadlineExceeded
			}
			p := &fakeProgramPhase{responses: []programResponse{r}, stopErr: errors.New("unit-only uncertain stop")}
			e := Executor{engine: &fakeProgramEngine{phase: p}}
			verdict, err := e.execute(context.Background(), s, nil, rawInputs(""), []string{"ok"}, map[string]int64{})
			if verdict != "" || !errors.Is(err, sandbox.ErrInfrastructure) || p.closed != 1 {
				t.Fatal("unconfirmed stop released a learner verdict", version, learner, verdict, err)
			}
			if p.stopContextErr != nil || p.stopDeadline.IsZero() || !p.stopDeadline.After(time.Now()) {
				t.Fatal("cleanup lacks a fresh bounded context")
			}
		}
	}
}

func TestUnconfirmedCompilerStopDiscardsBinaryAndCompileVerdict(t *testing.T) {
	for _, build := range []programResponse{{}, {exit: 1}, {err: context.DeadlineExceeded}} {
		p := &fakeProgramPhase{compile: true, build: build, stopErr: errors.New("unit-only ambiguous deletion")}
		e := Executor{engine: &fakeProgramEngine{phase: p}}
		binary, verdict, err := e.compile(context.Background(), programSnapshot(), []byte("package main\nfunc main() {}\n"), map[string]int64{})
		if binary != nil || verdict != "" || !errors.Is(err, sandbox.ErrInfrastructure) || p.closed != 1 {
			t.Fatal("unconfirmed compiler stop released output", verdict, err)
		}
	}
}

func TestGradingStopRemainsIndependentAfterParentExpiry(t *testing.T) {
	ctx := &probeExpiredContext{Context: context.Background(), done: make(chan struct{}), failure: context.DeadlineExceeded}
	p := &fakeProgramPhase{responses: []programResponse{{}}, onProbe: ctx.expire}
	e := Executor{engine: &fakeProgramEngine{phase: p}}
	verdict, err := e.execute(ctx, programSnapshot(), nil, rawInputs(""), []string{""}, map[string]int64{})
	if verdict != "" || !errors.Is(err, context.DeadlineExceeded) || p.closed != 1 || p.stopContextErr != nil || p.stopDeadline.IsZero() {
		t.Fatal("parent deadline prevented independent verified cleanup", verdict, err, p.stopContextErr)
	}
}
