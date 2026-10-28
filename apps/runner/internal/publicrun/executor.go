package publicrun

import (
	"context"
	"encoding/json"
	"errors"
	"nextera.local/runner/internal/sandbox"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type phase interface {
	ID() string
	Import(context.Context, map[string][]byte) error
	Exec(context.Context, []string, []string, []byte, int) ([]byte, []byte, int, error)
	CloseVerified(context.Context) error
}
type engine interface {
	VerifyImage(context.Context, string) error
	Create(context.Context, string, bool) (phase, error)
	CleanupVerified(context.Context) ([]string, error)
}
type dockerPhase struct{ c *sandbox.Container }

func (p dockerPhase) ID() string { return p.c.ID }
func (p dockerPhase) Import(ctx context.Context, f map[string][]byte) error {
	return p.c.Import(ctx, f)
}
func (p dockerPhase) Exec(ctx context.Context, c, e []string, i []byte, n int) ([]byte, []byte, int, error) {
	return p.c.Exec(ctx, c, e, i, n)
}
func (p dockerPhase) CloseVerified(ctx context.Context) error { return p.c.CloseVerified(ctx) }

type dockerEngine struct{ e *sandbox.Engine }

func (e dockerEngine) VerifyImage(ctx context.Context, d string) error {
	return e.e.VerifyImage(ctx, d)
}
func (e dockerEngine) Create(ctx context.Context, d string, c bool) (phase, error) {
	p, err := e.e.Create(ctx, d, c)
	if err != nil {
		return nil, err
	}
	return dockerPhase{p}, nil
}
func (e dockerEngine) CleanupVerified(ctx context.Context) ([]string, error) {
	return e.e.CloseJobVerified(ctx)
}

type Executor struct {
	pinnedImage string
	makeEngine  func(Request) engine
	now         func() time.Time
}

// New takes an operator-owned socket client and exact verified sandbox digest.
// It opens no connection, starts no process and installs no Run policy.
func New(e *sandbox.Engine, pinnedImage string) (*Executor, error) {
	if e == nil || e.HTTP == nil || !image.MatchString(pinnedImage) {
		return nil, ErrInvalid
	}
	return &Executor{pinnedImage: pinnedImage, now: time.Now, makeEngine: func(r Request) engine {
		copy := *e
		copy.Purpose = sandbox.VisibleRunPurpose
		copy.Job = r.Work.RunID
		copy.Attempt = r.ExecutionID
		return dockerEngine{&copy}
	}}, nil
}

// Execute runs only an already-authorized, fenced public-example work item.
// Its caller owns current-access/lease renewal and cancels ctx on any uncertainty.
// No database, auth, private pack, registry or source-storage credential is accepted.
func (e *Executor) Execute(ctx context.Context, r Request) (result Outcome, err error) {
	if e == nil || e.makeEngine == nil || e.now == nil || Validate(r, e.pinnedImage) != nil {
		return Outcome{}, ErrInvalid
	}
	intent := r.Work.Intent
	policy := r.Work.Policy
	result = Outcome{RunID: r.Work.RunID, IntentDigest: IntentDigest(intent), Generation: r.Generation, ExecutionID: r.ExecutionID, State: "system_error", Output: "", StoppedProof: nil}
	runtime := e.makeEngine(r)
	touched := map[string]bool{}
	createUncertain := false
	// Cleanup is independent of the cancelled lease context. Never fabricate stop proof.
	defer func() {
		stop, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		ids, cleanupErr := runtime.CleanupVerified(stop)
		if cleanupErr != nil || createUncertain {
			result.State = "system_error"
			result.Output = ""
			result.StoppedProof = nil
			return
		}
		for _, id := range ids {
			touched[id] = true
		}
		all := make([]string, 0, len(touched))
		for id := range touched {
			all = append(all, id)
		}
		sort.Strings(all)
		proof := sha(append([]byte("nextera-visible-run-stopped\x00v1\x00"), jsJSON([]any{r.Work.RunID, r.Generation, r.ExecutionID, result.IntentDigest, all})...))
		result.StoppedProof = &proof
	}()
	deadline, _ := time.Parse(time.RFC3339Nano, intent.Deadline)
	if !e.now().Before(deadline) || ctx.Err() != nil {
		return result, nil
	}
	run, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	// startupMs is the aggregate trusted setup/transfer/inspection budget across
	// both phases, separate from compilation and learner execution deadlines.
	remaining := time.Duration(policy.Budgets.StartupMS) * time.Millisecond
	setup := func(call func(context.Context) error) error {
		if remaining <= 0 {
			return sandbox.ErrInfrastructure
		}
		c, cancel := context.WithTimeout(run, remaining)
		start := time.Now()
		err := call(c)
		remaining -= time.Since(start)
		cancel()
		return err
	}
	if setup(func(c context.Context) error { return runtime.VerifyImage(c, e.pinnedImage) }) != nil {
		return result, nil
	}
	create := func(compile bool) (phase, error) {
		var p phase
		err := setup(func(c context.Context) error {
			var err error
			p, err = runtime.Create(c, e.pinnedImage, compile)
			return err
		})
		if err != nil {
			createUncertain = true
			return nil, err
		}
		if p == nil || !containerIDValid(p.ID()) {
			createUncertain = true
			return nil, sandbox.ErrInfrastructure
		}
		touched[p.ID()] = true
		return p, nil
	}
	compiler, err := create(true)
	if err != nil {
		return result, nil
	}
	transport := []byte("package main\nimport(\"encoding/json\";\"os\")\nfunc main(){var inputs []" + r.Work.Manifest.Harness.Argument + ";if json.NewDecoder(os.Stdin).Decode(&inputs)!=nil{os.Exit(2)};outputs:=make([]string,0,len(inputs));for _,v:=range inputs{outputs=append(outputs," + r.Work.Manifest.Harness.FunctionName + "(v))};if json.NewEncoder(os.Stdout).Encode(outputs)!=nil{os.Exit(2)}}\n")
	if setup(func(c context.Context) error {
		return compiler.Import(c, map[string][]byte{"solution.go": []byte(intent.Source), "transport.go": transport})
	}) != nil {
		return result, nil
	}
	compileCtx, compileCancel := context.WithTimeout(run, time.Duration(policy.Budgets.CompilationMS)*time.Millisecond)
	_, _, exit, compileErr := compiler.Exec(compileCtx, []string{"/bin/sh", "-c", "cp -as /opt/go-cache /workspace/cache && exec go build -trimpath -buildvcs=false -p=1 -ldflags=-buildid= -o /workspace/program /workspace/solution.go /workspace/transport.go"}, []string{"GOMEMLIMIT=384MiB"}, nil, 65536)
	compileCancel()
	if run.Err() != nil {
		return result, nil
	}
	if errors.Is(compileErr, context.DeadlineExceeded) || errors.Is(compileErr, sandbox.ErrOutput) || (compileErr == nil && exit != 0) {
		result.State = "compile_error"
		result.Output = "Compilation failed."
		return result, nil
	}
	if compileErr != nil {
		return result, nil
	}
	var program []byte
	if setup(func(c context.Context) error {
		raw, _, code, err := compiler.Exec(c, []string{"/bin/tar", "--format=ustar", "-cf", "-", "-C", "/workspace", "program"}, nil, nil, 8<<20)
		if err != nil || code != 0 {
			return sandbox.ErrInfrastructure
		}
		program, err = sandbox.Compiled(raw)
		return err
	}) != nil {
		return result, nil
	}
	if setup(func(c context.Context) error { return compiler.CloseVerified(c) }) != nil {
		return result, nil
	}
	runner, err := create(false)
	if err != nil {
		return result, nil
	}
	if setup(func(c context.Context) error { return runner.Import(c, map[string][]byte{"program": program}) }) != nil {
		return result, nil
	}
	if setup(func(c context.Context) error {
		_, _, code, err := runner.Exec(c, []string{"/bin/chmod", "500", "/workspace/program"}, nil, nil, 65536)
		if err != nil || code != 0 {
			return sandbox.ErrInfrastructure
		}
		return nil
	}) != nil {
		return result, nil
	}
	inputs := make([]json.RawMessage, len(r.Work.Manifest.Examples))
	for n, example := range r.Work.Manifest.Examples {
		if r.Work.Manifest.Harness.Argument == "string" {
			inputs[n] = jsJSON(example.Input)
		} else {
			inputs[n] = []byte(example.Input)
		}
	}
	input, _ := json.Marshal(inputs)
	executeCtx, executeCancel := context.WithTimeout(run, time.Duration(policy.Limits.TimeoutMS)*time.Millisecond)
	output, stderr, exit, executeErr := runner.Exec(executeCtx, []string{"/workspace/program"}, nil, input, int(policy.Limits.OutputBytes))
	executeCancel()
	if run.Err() != nil {
		return result, nil
	}
	if errors.Is(executeErr, context.DeadlineExceeded) {
		result.State = "timeout"
		result.Output = "Execution timed out."
		return result, nil
	}
	if errors.Is(executeErr, sandbox.ErrOutput) {
		result.State = "output_limit"
		result.Output = "Execution output limit exceeded."
		return result, nil
	}
	if executeErr != nil {
		return result, nil
	}
	if exit != 0 || len(stderr) != 0 {
		result.State = "runtime_error"
		result.Output = "Execution failed."
		return result, nil
	}
	if resourceErr := setup(func(c context.Context) error { return resourceCheck(c, runner) }); resourceErr != nil {
		if errors.Is(resourceErr, errResourceLimit) {
			result.State = "runtime_error"
			result.Output = "Execution exceeded its resource allowance."
		}
		return result, nil
	}
	// The adapter ABI is one JSON array of string returns. No expected value or
	// private oracle is passed to the sandbox or compared to the learner's values.
	var rows []json.RawMessage
	if !utf8.Valid(output) || !validEscapes(output) || json.Unmarshal(output, &rows) != nil || len(rows) != len(inputs) {
		result.State = "runtime_error"
		result.Output = "Execution returned an invalid response."
		return result, nil
	}
	actual := make([]string, len(rows))
	for n, raw := range rows {
		if len(raw) < 2 || raw[0] != '"' || json.Unmarshal(raw, &actual[n]) != nil || !utf8.ValidString(actual[n]) {
			result.State = "runtime_error"
			result.Output = "Execution returned an invalid response."
			return result, nil
		}
	}
	result.Output = string(jsJSON(actual))
	if int64(len(result.Output)) > policy.Limits.OutputBytes {
		result.State = "output_limit"
		result.Output = "Execution output limit exceeded."
		return result, nil
	}
	result.State = "completed"
	return result, nil
}
func containerIDValid(id string) bool {
	if len(id) != 64 {
		return false
	}
	for _, c := range id {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

var errResourceLimit = errors.New("PUBLIC_RESOURCE_LIMIT")

func resourceCheck(ctx context.Context, c phase) error {
	for _, pair := range [][2]string{{"pids", "max"}, {"memory", "oom_kill"}} {
		raw, _, exit, err := c.Exec(ctx, []string{"/bin/cat", "/sys/fs/cgroup/" + pair[0] + ".events"}, nil, nil, 65536)
		if err != nil || exit != 0 {
			return sandbox.ErrInfrastructure
		}
		seen := false
		for _, line := range strings.Split(string(raw), "\n") {
			fields := strings.Fields(line)
			if len(fields) == 2 && fields[0] == pair[1] {
				seen = true
				if fields[1] != "0" {
					return errResourceLimit
				}
			}
		}
		if !seen {
			return sandbox.ErrInfrastructure
		}
	}
	raw, _, exit, err := c.Exec(ctx, []string{"/usr/bin/stat", "-f", "-c", "%a %d", "/workspace", "/tmp", "/dev/shm"}, nil, nil, 65536)
	if err != nil || exit != 0 {
		return sandbox.ErrInfrastructure
	}
	fields := strings.Fields(string(raw))
	if len(fields) != 6 {
		return sandbox.ErrInfrastructure
	}
	for _, f := range fields {
		n, err := strconv.ParseInt(f, 10, 64)
		if err != nil {
			return sandbox.ErrInfrastructure
		}
		if n <= 0 {
			return errResourceLimit
		}
	}
	return nil
}
