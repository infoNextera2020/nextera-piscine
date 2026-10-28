package publicrun

import (
	"context"
	"encoding/json"
	"errors"
	"nextera.local/runner/internal/sandbox"
	"strings"
	"testing"
	"time"
)

const testImage = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func fixture() Request {
	r := Request{Version: 1, Generation: 1, ExecutionID: "00000000-0000-8000-8000-000000000006", Work: Work{RunID: "00000000-0000-4000-8000-000000000001"}}
	r.Work.Manifest = Manifest{Version: 1, Visibility: "visible_examples", Language: "go", TaskKey: "hello-go", DefinitionDigest: strings.Repeat("b", 64), Filename: "hello.go", Harness: Harness{Kind: "go_function_v1", PackageName: "main", FunctionName: "Hello", Argument: "string", Returns: "string"}, Examples: []Example{{Key: "public-a", Input: "visible input", ExpectedOutput: "NOT_AN_ORACLE"}}}
	r.Work.Policy = Policy{Version: 1, Key: "fake-unit-policy", Enabled: true, Visibility: "visible_examples", Limits: Limits{TimeoutMS: 2000, MemoryMB: 64, OutputBytes: 65536, SourceBytes: 1024, RequestsPerWindow: 1, WindowMS: 10000, Concurrency: 1}, MaxExamples: 1, Budgets: Budgets{CompilationMS: 20000, StartupMS: 1000, LeaseMS: 30000}, Storage: Storage{MaxRunsPerAttempt: 1, MaxSourceBytesPerAttempt: 1024}, Isolation: Isolation{ImageDigest: testImage, Network: "none", HostAccess: "none", Filesystem: "disposable", ProcessUser: "unprivileged", ResourceEnforcement: "external"}}
	r.Work.Intent = Intent{Scope: Scope{LearnerID: "00000000-0000-4000-8000-000000000002", CohortID: "00000000-0000-4000-8000-000000000003", AttemptID: "00000000-0000-4000-8000-000000000004", TaskKey: "hello-go", DefinitionDigest: strings.Repeat("b", 64)}, RequestID: "00000000-0000-4000-8000-000000000005", Filename: "hello.go", Source: "package main\nfunc Hello(s string) string { return s }\n", Deadline: "2099-01-01T00:00:00.000Z"}
	rebind(&r)
	return r
}
func rebind(r *Request) {
	i := &r.Work.Intent
	i.ByteLength = len(i.Source)
	i.SourceDigest = sha([]byte(i.Source))
	i.ManifestDigest = ManifestDigest(r.Work.Manifest)
	i.PolicyDigest = PolicyDigest(r.Work.Policy)
}

type fakePhase struct {
	owner   *fakeEngine
	compile bool
	id      string
	files   map[string][]byte
}

func (p *fakePhase) ID() string                                          { return p.id }
func (p *fakePhase) Import(_ context.Context, f map[string][]byte) error { p.files = f; return nil }
func (p *fakePhase) CloseVerified(context.Context) error                 { p.owner.closed++; return p.owner.closeErr }
func (p *fakePhase) Exec(ctx context.Context, cmd, env []string, input []byte, cap int) ([]byte, []byte, int, error) {
	switch cmd[0] {
	case "/bin/sh":
		return nil, nil, p.owner.compileExit, p.owner.compileErr
	case "/bin/tar":
		raw, _ := sandbox.Archive(map[string][]byte{"program": {0x7f, 'E', 'L', 'F', 1}})
		return raw, nil, 0, nil
	case "/bin/chmod":
		return nil, nil, 0, nil
	case "/workspace/program":
		p.owner.input = string(input)
		if p.owner.waitCancel {
			p.owner.started <- struct{}{}
			<-ctx.Done()
			return nil, nil, 0, ctx.Err()
		}
		return []byte(p.owner.output), []byte(p.owner.stderr), p.owner.exit, p.owner.execErr
	case "/bin/cat":
		if p.owner.resourceErr != nil {
			return nil, nil, 0, p.owner.resourceErr
		}
		if p.owner.resourceLimited {
			return []byte("max 1\noom_kill 1\n"), nil, 0, nil
		}
		return []byte("max 0\noom_kill 0\n"), nil, 0, nil
	case "/usr/bin/stat":
		return []byte("1 1 1 1 1 1\n"), nil, 0, nil
	}
	return nil, nil, 0, errors.New("unexpected fake command")
}

type fakeEngine struct {
	phases                                                                       []*fakePhase
	input, output, stderr                                                        string
	exit, compileExit, closed, cleanup                                           int
	verifyErr, createErr, closeErr, cleanupErr, execErr, compileErr, resourceErr error
	resourceLimited, waitCancel                                                  bool
	started                                                                      chan struct{}
	cleanupCancelled                                                             bool
}

func (f *fakeEngine) VerifyImage(context.Context, string) error { return f.verifyErr }
func (f *fakeEngine) Create(_ context.Context, _ string, c bool) (phase, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	p := &fakePhase{owner: f, compile: c, id: strings.Repeat("c", 64)}
	if !c {
		p.id = strings.Repeat("d", 64)
	}
	f.phases = append(f.phases, p)
	return p, nil
}
func (f *fakeEngine) CleanupVerified(ctx context.Context) ([]string, error) {
	f.cleanup++
	f.cleanupCancelled = ctx.Err() != nil
	ids := []string{}
	for _, p := range f.phases {
		ids = append(ids, p.id)
	}
	return ids, f.cleanupErr
}
func fakeExecutor(f *fakeEngine) *Executor {
	return &Executor{pinnedImage: testImage, makeEngine: func(Request) engine { return f }, now: func() time.Time { return time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC) }}
}

func TestActualReturnsNotExpectedOracle(t *testing.T) {
	f := &fakeEngine{output: `["actual learner return"]`}
	r := fixture()
	out, err := fakeExecutor(f).Execute(context.Background(), r)
	if err != nil || out.State != "completed" || out.Output != f.output || out.StoppedProof == nil || f.cleanup != 1 || f.closed != 1 {
		t.Fatalf("unexpected outcome: %#v %v", out, err)
	}
	if f.input != `["visible input"]` {
		t.Fatal("public input order changed")
	}
	for _, p := range f.phases {
		for _, b := range p.files {
			if strings.Contains(string(b), "NOT_AN_ORACLE") {
				t.Fatal("expected output reached sandbox")
			}
		}
	}
	if out.IntentDigest != IntentDigest(r.Work.Intent) || out.Generation != r.Generation || out.ExecutionID != r.ExecutionID {
		t.Fatal("binding lost")
	}
}
func TestPublicTerminalStatesAndNoDiagnostics(t *testing.T) {
	cases := []struct {
		name, state string
		mutate      func(*fakeEngine)
	}{
		{"compile", "compile_error", func(f *fakeEngine) { f.compileExit = 2 }},
		{"compile-timeout", "compile_error", func(f *fakeEngine) { f.compileErr = context.DeadlineExceeded }},
		{"timeout", "timeout", func(f *fakeEngine) { f.execErr = context.DeadlineExceeded }},
		{"output", "output_limit", func(f *fakeEngine) { f.execErr = sandbox.ErrOutput }},
		{"runtime", "runtime_error", func(f *fakeEngine) { f.exit = 2; f.stderr = "SECRET_DIAGNOSTIC" }},
		{"stderr", "runtime_error", func(f *fakeEngine) { f.stderr = "SECRET_DIAGNOSTIC" }},
		{"malformed", "runtime_error", func(f *fakeEngine) { f.output = `{"not":"returns"}` }},
		{"null-return", "runtime_error", func(f *fakeEngine) { f.output = `[null]` }},
		{"unpaired-surrogate", "runtime_error", func(f *fakeEngine) { f.output = `["\ud800"]` }},
		{"resource-limit", "runtime_error", func(f *fakeEngine) { f.resourceLimited = true }},
		{"resource-read-failure", "system_error", func(f *fakeEngine) { f.resourceErr = sandbox.ErrInfrastructure }},
		{"verification", "system_error", func(f *fakeEngine) { f.verifyErr = errors.New("SECRET_DIAGNOSTIC") }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := &fakeEngine{output: `["ok"]`}
			c.mutate(f)
			out, err := fakeExecutor(f).Execute(context.Background(), fixture())
			if err != nil || out.State != c.state || out.StoppedProof == nil || strings.Contains(out.Output, "SECRET") {
				t.Fatalf("%#v %v", out, err)
			}
			if c.state == "system_error" && out.Output != "" {
				t.Fatal("infrastructure diagnostics exposed")
			}
		})
	}
}
func TestUncertainCleanupOrCreateWithholdsProof(t *testing.T) {
	for _, create := range []bool{false, true} {
		f := &fakeEngine{output: `["ok"]`}
		if create {
			f.createErr = sandbox.ErrInfrastructure
		} else {
			f.cleanupErr = sandbox.ErrInfrastructure
		}
		out, err := fakeExecutor(f).Execute(context.Background(), fixture())
		if err != nil || out.State != "system_error" || out.Output != "" || out.StoppedProof != nil || f.cleanup != 1 {
			t.Fatal("uncertainty released capacity")
		}
	}
}
func TestLeaseCancellationUsesIndependentCleanup(t *testing.T) {
	f := &fakeEngine{waitCancel: true, started: make(chan struct{}, 1)}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan Outcome, 1)
	go func() { out, _ := fakeExecutor(f).Execute(ctx, fixture()); done <- out }()
	<-f.started
	cancel()
	out := <-done
	if out.State != "system_error" || out.StoppedProof == nil || f.cleanupCancelled {
		t.Fatal("cancelled lease prevented verified stop")
	}
}
func TestInvalidPolicyNeverCreatesEngine(t *testing.T) {
	r := fixture()
	r.Work.Policy.Enabled = false
	rebind(&r)
	called := false
	e := fakeExecutor(nil)
	e.makeEngine = func(Request) engine { called = true; return nil }
	if _, err := e.Execute(context.Background(), r); err == nil || called {
		t.Fatal("disabled policy reached executor")
	}
}
func TestDeadlineExpiredNeverCreatesPhase(t *testing.T) {
	f := &fakeEngine{}
	r := fixture()
	r.Work.Intent.Deadline = "2020-01-01T00:00:00Z"
	out, err := fakeExecutor(f).Execute(context.Background(), r)
	if err != nil || len(f.phases) != 0 || out.State != "system_error" || out.StoppedProof == nil {
		t.Fatal("expired source executed")
	}
}
func TestExactSourceNotRewritten(t *testing.T) {
	r := fixture()
	r.Work.Intent.Source = "package main\r\n// exact bytes \u2028\nfunc Hello(s string) string { return s }\n"
	rebind(&r)
	f := &fakeEngine{output: `["ok"]`}
	_, err := fakeExecutor(f).Execute(context.Background(), r)
	if err != nil || string(f.phases[0].files["solution.go"]) != r.Work.Intent.Source {
		t.Fatal("source bytes changed")
	}
}
func TestStrictEnvelopeParsingAndValidation(t *testing.T) {
	r := fixture()
	raw, _ := json.Marshal(r)
	parsed, err := ParseRequest(raw)
	if err != nil || Validate(parsed, testImage) != nil {
		t.Fatal("valid envelope rejected")
	}
	for _, bad := range []string{`null`, string(raw) + `{}`, strings.Replace(string(raw), `"version":1`, `"version":1,"version":1`, 1), strings.Replace(string(raw), `"graded":false`, `"graded":null`, 1), strings.Replace(string(raw), `"expectedOutput":"NOT_AN_ORACLE"`, `"expectedOutput":null`, 1), strings.Replace(string(raw), `"key":"public-a"`, `"key":"public-a","extra":1`, 1), strings.Replace(string(raw), `"visible input"`, `"\ud800"`, 1)} {
		if _, err := ParseRequest([]byte(bad)); err == nil {
			t.Fatal("malformed envelope accepted")
		}
	}
}
func TestRejectsProfileAndBindingMismatch(t *testing.T) {
	cases := []func(*Request){func(r *Request) { r.Work.Manifest.Harness.PackageName = "student" }, func(r *Request) { r.Work.Policy.Limits.TimeoutMS = 3000 }, func(r *Request) { r.Work.Policy.Limits.MemoryMB = 128 }, func(r *Request) { r.Work.Policy.Isolation.Network = "bridge" }, func(r *Request) { r.Work.Policy.Graded = true }, func(r *Request) { r.Work.Policy.ConsumesGradedAttempts = true }, func(r *Request) { r.Work.Manifest.Harness.FunctionName = "bad();evil" }, func(r *Request) { r.Work.Intent.SourceDigest = strings.Repeat("f", 64) }}
	for _, change := range cases {
		r := fixture()
		change(&r)
		if Validate(r, testImage) == nil {
			t.Fatal("unsafe public contract accepted")
		}
	}
}

func TestPublicInt64BoundariesPreserveExactInput(t *testing.T) {
	for _, input := range []string{"-9223372036854775808", "9223372036854775807"} {
		r := fixture()
		r.Work.Manifest.Harness.Argument = "int64"
		r.Work.Manifest.Examples[0].Input = input
		rebind(&r)
		f := &fakeEngine{output: `["ok"]`}
		out, err := fakeExecutor(f).Execute(context.Background(), r)
		if err != nil || out.State != "completed" || f.input != "["+input+"]" {
			t.Fatal("int64 input rounded or rejected")
		}
	}
	for _, input := range []string{"9223372036854775808", "-9223372036854775809", "1.0", "01", "-0"} {
		r := fixture()
		r.Work.Manifest.Harness.Argument = "int64"
		r.Work.Manifest.Examples[0].Input = input
		rebind(&r)
		if Validate(r, testImage) == nil {
			t.Fatal("invalid integer accepted")
		}
	}
}
