package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"nextera.local/runner/internal/publicrun"
	"strings"
	"testing"
	"time"
)

type fakePublicExecutor struct {
	result publicrun.Outcome
	err    error
	called bool
}

func (f *fakePublicExecutor) Execute(_ context.Context, r publicrun.Request) (publicrun.Outcome, error) {
	f.called = true
	f.result.RunID = r.Work.RunID
	f.result.IntentDigest = publicrun.IntentDigest(r.Work.Intent)
	f.result.Generation = r.Generation
	f.result.ExecutionID = r.ExecutionID
	return f.result, f.err
}
func cliFixture() publicrun.Request {
	r := publicrun.Request{Version: 1, Generation: 1, ExecutionID: "00000000-0000-8000-8000-000000000006", Work: publicrun.Work{RunID: "00000000-0000-4000-8000-000000000001"}}
	r.Work.Manifest = publicrun.Manifest{Version: 1, Visibility: "visible_examples", Language: "go", TaskKey: "hello-go", DefinitionDigest: strings.Repeat("b", 64), Filename: "hello.go", Harness: publicrun.Harness{Kind: "go_function_v1", PackageName: "main", FunctionName: "Hello", Argument: "string", Returns: "string"}, Examples: []publicrun.Example{{Key: "public-a", Input: "hi", ExpectedOutput: "visible"}}}
	r.Work.Policy = publicrun.Policy{Version: 1, Key: "fake-unit-policy", Enabled: true, Visibility: "visible_examples", Limits: publicrun.Limits{TimeoutMS: 2000, MemoryMB: 64, OutputBytes: 65536, SourceBytes: 1024, RequestsPerWindow: 1, WindowMS: 10000, Concurrency: 1}, MaxExamples: 1, Budgets: publicrun.Budgets{CompilationMS: 20000, StartupMS: 1000, LeaseMS: 30000}, Storage: publicrun.Storage{MaxRunsPerAttempt: 1, MaxSourceBytesPerAttempt: 1024}, Isolation: publicrun.Isolation{ImageDigest: "sha256:" + strings.Repeat("a", 64), Network: "none", HostAccess: "none", Filesystem: "disposable", ProcessUser: "unprivileged", ResourceEnforcement: "external"}}
	r.Work.Intent = publicrun.Intent{Scope: publicrun.Scope{LearnerID: "00000000-0000-4000-8000-000000000002", CohortID: "00000000-0000-4000-8000-000000000003", AttemptID: "00000000-0000-4000-8000-000000000004", TaskKey: "hello-go", DefinitionDigest: strings.Repeat("b", 64)}, RequestID: "00000000-0000-4000-8000-000000000005", Filename: "hello.go", Source: "package main", SourceDigest: "5121f3fe335a0fb94ae1e79e9e15b96c1c79822e70c04c140c6e4f27c6642154", ByteLength: 12, Deadline: "2099-01-01T00:00:00Z"}
	sourceHash := sha256.Sum256([]byte(r.Work.Intent.Source))
	r.Work.Intent.SourceDigest = hex.EncodeToString(sourceHash[:])
	r.Work.Intent.ManifestDigest = publicrun.ManifestDigest(r.Work.Manifest)
	r.Work.Intent.PolicyDigest = publicrun.PolicyDigest(r.Work.Policy)
	return r
}
func TestPublicCommandIsBoundedAndRequiresExplicitOptions(t *testing.T) {
	r := cliFixture()
	raw, _ := json.Marshal(r)
	args := []string{"--runner-image", r.Work.Policy.Isolation.ImageDigest, "--docker-socket", "/unit/not-a-real-socket"}
	for _, tc := range []struct {
		name string
		args []string
		raw  []byte
	}{{"missing-options", nil, raw}, {"tcp", []string{"--runner-image", r.Work.Policy.Isolation.ImageDigest, "--docker-socket", "tcp://remote"}, raw}, {"extra-option", append(append([]string{}, args...), "--storage-token", "SECRET"), raw}, {"malformed", args, []byte(`{}`)}, {"oversized", args, bytes.Repeat([]byte("x"), publicrun.MaxRequestBytes+1)}} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			var output bytes.Buffer
			err := publicRunStdio(context.Background(), tc.args, bytes.NewReader(tc.raw), &output, func(string, string) (publicRunExecutor, error) { called = true; return nil, nil })
			if err == nil || called || strings.Contains(output.String(), "SECRET") || !json.Valid(output.Bytes()) {
				t.Fatal("invalid request reached runtime factory")
			}
		})
	}
}
func TestPublicCommandEmitsOnlyBoundOutcome(t *testing.T) {
	r := cliFixture()
	raw, _ := json.Marshal(r)
	proof := strings.Repeat("d", 64)
	f := &fakePublicExecutor{result: publicrun.Outcome{State: "completed", Output: `["actual"]`, StoppedProof: &proof}}
	var out bytes.Buffer
	err := publicRunStdio(context.Background(), []string{"--runner-image", r.Work.Policy.Isolation.ImageDigest, "--docker-socket", "/unit/not-a-real-socket"}, bytes.NewReader(raw), &out, func(string, string) (publicRunExecutor, error) { return f, nil })
	var result publicrun.Outcome
	if err != nil || !f.called || json.Unmarshal(out.Bytes(), &result) != nil || result.Output != `["actual"]` || result.StoppedProof == nil {
		t.Fatalf("valid command failed: %v %s", err, out.String())
	}
	if strings.Contains(out.String(), "package main") || strings.Contains(out.String(), "expectedOutput") {
		t.Fatal("input leaked")
	}
}
func TestPublicCommandRedactsErrorsAndDoesNotInventStopProof(t *testing.T) {
	for _, fail := range []bool{false, true} {
		r := cliFixture()
		raw, _ := json.Marshal(r)
		f := &fakePublicExecutor{result: publicrun.Outcome{State: "system_error", Output: "SECRET_DIAGNOSTIC"}}
		if fail {
			f.err = errors.New("SECRET_DIAGNOSTIC")
		}
		var out bytes.Buffer
		err := publicRunStdio(context.Background(), []string{"--runner-image", r.Work.Policy.Isolation.ImageDigest, "--docker-socket", "/unit/not-a-real-socket"}, bytes.NewReader(raw), &out, func(string, string) (publicRunExecutor, error) { return f, nil })
		if strings.Contains(out.String(), "SECRET") {
			t.Fatal("diagnostics exposed")
		}
		if fail && err == nil {
			t.Fatal("executor error hidden as success")
		}
		if !fail {
			var result publicrun.Outcome
			if json.Unmarshal(out.Bytes(), &result) != nil || result.StoppedProof != nil || result.Output != "" {
				t.Fatal("proof invented")
			}
		}
	}
}

func TestPublicCommandRejectsCancelledContextBeforeFactory(t *testing.T) {
	reader, writer := io.Pipe()
	defer writer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var out bytes.Buffer
	called := false
	err := publicRunStdio(ctx, []string{"--runner-image", "sha256:" + strings.Repeat("a", 64), "--docker-socket", "/unit/no-socket"}, reader, &out, func(string, string) (publicRunExecutor, error) { called = true; return nil, nil })
	if err == nil || called || !json.Valid(out.Bytes()) {
		t.Fatal("cancelled request reached factory")
	}
}
func TestPublicCommandRejectsUnknownSecretsAndInvalidProof(t *testing.T) {
	r := cliFixture()
	raw, _ := json.Marshal(r)
	args := []string{"--runner-image", r.Work.Policy.Isolation.ImageDigest, "--docker-socket", "/unit/no-socket"}
	secret := strings.Replace(string(raw), `"version":1`, `"version":1,"leaseToken":"NEVER_ECHO"`, 1)
	var out bytes.Buffer
	called := false
	if publicRunStdio(context.Background(), args, strings.NewReader(secret), &out, func(string, string) (publicRunExecutor, error) { called = true; return nil, nil }) == nil || called || strings.Contains(out.String(), "NEVER_ECHO") {
		t.Fatal("untrusted token envelope accepted")
	}
	bad := "NEVER_ECHO"
	f := &fakePublicExecutor{result: publicrun.Outcome{State: "completed", Output: `["ok"]`, StoppedProof: &bad}}
	out.Reset()
	if publicRunStdio(context.Background(), args, bytes.NewReader(raw), &out, func(string, string) (publicRunExecutor, error) { return f, nil }) == nil || strings.Contains(out.String(), bad) {
		t.Fatal("invalid stop proof accepted or echoed")
	}
}

type signalledReader struct {
	io.ReadCloser
	started chan struct{}
}

func (r signalledReader) Read(p []byte) (int, error) { close(r.started); return r.ReadCloser.Read(p) }
func TestPublicCommandCancelsDuringStdinRead(t *testing.T) {
	reader, writer := io.Pipe()
	defer writer.Close()
	started := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var output bytes.Buffer
	done := make(chan error, 1)
	called := false
	go func() {
		done <- publicRunStdio(ctx, []string{"--runner-image", "sha256:" + strings.Repeat("a", 64), "--docker-socket", "/unit/no-socket"}, signalledReader{reader, started}, &output, func(string, string) (publicRunExecutor, error) { called = true; return nil, nil })
	}()
	<-started
	cancel()
	select {
	case err := <-done:
		if err == nil || called {
			t.Fatal("cancelled input reached factory")
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled stdin remained blocked")
	}
}
