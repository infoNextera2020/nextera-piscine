package atm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/protocol"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixture() (protocol.Snapshot, protocol.Claim, Context) {
	id := "11111111-1111-4111-8111-111111111111"
	digest := strings.Repeat("a", 64)
	s := protocol.Snapshot{PackID: "atm-v1", CurriculumID: id, Node: "week1-atm", Cohort: id, Submission: id, SpecDigest: digest, Source: protocol.Source{Digest: digest}, VerifiedJob: id, VerifiedJudgeAttempt: id, VerifiedWorker: id, VerifiedGeneration: 1, VerifiedDigest: digest, Entry: artifact.Entry{Contract: &artifact.ExecutionContract{Version: 4, Item: "week1-atm", File: "main.go", Input: "stdin_utf8", Output: "atm_report_events_v1"}, SemanticProfileDigest: json.RawMessage(`"` + SemanticProfileDigest + `"`), Digest: digest, Runner: "sha256:" + digest, Environment: artifact.Environment{Sandbox: "sha256:" + digest, Toolchain: artifact.Toolchain, Platform: artifact.Platform, Flags: []string{"-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid="}, Dependencies: "offline", Profile: artifact.Profile, Resources: artifact.PilotResources(), Protocol: 1, Snapshot: 1, Generation: artifact.Generation{Mode: "static"}}}}
	claim := protocol.Claim{Job: id, Attempt: id, Worker: id, Token: "22222222-2222-4222-8222-222222222222", Generation: 1, Digest: digest}
	resource, _ := ResourceDigest(s.Environment)
	c := Context{Version: 1, JobID: id, JudgeAttemptID: id, WorkerID: id, Generation: "1", SubmissionID: id, RaidAttemptID: id, TeamID: id, CohortID: id, CurriculumVersionID: id, NodeKey: s.Node, SourceSHA256: digest, EvaluationSnapshotDigest: digest, EvaluationSpecDigest: digest, DefinitionDigest: digest, TestPackID: s.PackID, TestPackDigest: digest, SemanticProfileDigest: SemanticProfileDigest, RunnerImageDigest: s.Runner, ResourcePolicyDigest: resource, ModelID: ModelID, CaseCount: 2}
	c.ContextDigest, _ = c.Digest()
	return s, claim, c
}
func fixtureEvidence() Evidence {
	_, _, c := fixture()
	zero := 0
	entry := Capture{CaseFile: "cases/public.json", CaseIndex: 0, InputSHA256: SHA(nil), StdinBase64: "", StdoutBase64: base64.StdEncoding.EncodeToString([]byte("[\"end\",null]\n")), StderrBase64: base64.StdEncoding.EncodeToString([]byte("private human words")), ExitCode: &zero, TransportWriteComplete: true, StdinHalfClosed: true, OutputComplete: true, Termination: "exited", Assessment: "observations_match"}
	other := entry
	other.CaseFile = "cases/private.json"
	other.CaseIndex = 1
	return Evidence{c, []Capture{entry, other}, true}
}
func testClient(t *testing.T) *Client {
	t.Helper()
	dir := t.TempDir()
	if os.Chmod(dir, 0700) != nil {
		t.Fatal("chmod")
	}
	config := Config{1, "http://127.0.0.1:3151", dir, 1 << 20, 1 << 20, 20, 10, 10 << 20, 1000, time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)}
	path := filepath.Join(t.TempDir(), "config.json")
	raw, _ := json.Marshal(config)
	if os.WriteFile(path, raw, 0600) != nil {
		t.Fatal("config")
	}
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

type fakeHTTP func(*http.Request) (*http.Response, error)

func (f fakeHTTP) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(body any) *http.Response {
	raw, _ := json.Marshal(body)
	return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw))}
}
func ackFor(raw []byte, state string) Ack {
	var m map[string]json.RawMessage
	_ = json.Unmarshal(raw, &m)
	var op, digest string
	var c Context
	_ = json.Unmarshal(m["operationId"], &op)
	_ = json.Unmarshal(m["captureDigest"], &digest)
	_ = json.Unmarshal(m["context"], &c)
	return Ack{1, op, c.ContextDigest, digest, state}
}
func TestATMHTTPExactContextAndNoCredentialPersistence(t *testing.T) {
	c := testClient(t)
	s, claim, binding := fixture()
	calls := 0
	c.http.Transport = fakeHTTP(func(r *http.Request) (*http.Response, error) {
		calls++
		raw, _ := io.ReadAll(r.Body)
		if r.Header.Get("Authorization") != "Bearer "+claim.Token || bytes.Contains(raw, []byte(claim.Token)) || r.URL.Host != "127.0.0.1:3151" {
			t.Fatal("claim token routing/body leak")
		}
		if strings.HasSuffix(r.URL.Path, "/resolve") {
			var m map[string]json.RawMessage
			_ = json.Unmarshal(raw, &m)
			if len(m) != 7 {
				t.Fatal("resolve schema drift")
			}
			return response(binding), nil
		}
		return response(ackFor(raw, "retained")), nil
	})
	resolved, err := c.Resolve(context.Background(), claim, s)
	if err != nil || resolved.ContextDigest != binding.ContextDigest {
		t.Fatal("authoritative context failed", err)
	}
	if c.Acknowledge(context.Background(), claim, fixtureEvidence()) != nil || calls != 2 {
		t.Fatal("retention handoff failed")
	}
	files, _ := os.ReadDir(c.config.ReceiptDirectory)
	if len(files) != 1 {
		t.Fatal("no immutable receipt")
	}
	raw, _ := os.ReadFile(filepath.Join(c.config.ReceiptDirectory, files[0].Name()))
	if bytes.Contains(raw, []byte(claim.Token)) {
		t.Fatal("token persisted")
	}
}
func TestATMHTTPUnknownReconcileAndNoAutomaticWriteRetry(t *testing.T) {
	for _, state := range []string{"retained", "not_retained", "invalid"} {
		t.Run(state, func(t *testing.T) {
			c := testClient(t)
			_, claim, _ := fixture()
			calls := []string{}
			c.http.Transport = fakeHTTP(func(r *http.Request) (*http.Response, error) {
				raw, _ := io.ReadAll(r.Body)
				calls = append(calls, r.URL.Path)
				if strings.HasSuffix(r.URL.Path, "/retain") {
					return nil, errors.New("private untrusted diagnostic")
				}
				return response(ackFor(raw, state)), nil
			})
			err := c.Acknowledge(context.Background(), claim, fixtureEvidence())
			if (state == "retained") != (err == nil) || len(calls) != 2 || !strings.HasSuffix(calls[1], "/reconcile") {
				t.Fatal("uncertain retain was retried/rebound", err, calls)
			}
		})
	}
}
func TestATMExplicitRetryKeepsOriginalEnvelopeAndCurrentClaim(t *testing.T) {
	c := testClient(t)
	_, claim, _ := fixture()
	p, err := c.Prepare(fixtureEvidence())
	if err != nil {
		t.Fatal(err)
	}
	var bodies [][]byte
	c.http.Transport = fakeHTTP(func(r *http.Request) (*http.Response, error) {
		raw, _ := io.ReadAll(r.Body)
		if strings.HasSuffix(r.URL.Path, "/reconcile") {
			return response(ackFor(raw, "not_retained")), nil
		}
		bodies = append(bodies, bytes.Clone(raw))
		if len(bodies) == 1 {
			return nil, errors.New("unknown")
		}
		return response(ackFor(raw, "retained")), nil
	})
	if c.Retain(context.Background(), claim, p) != ErrUnknown {
		t.Fatal("unknown lost")
	}
	if c.Retry(context.Background(), claim, p) != ErrUnavailable || c.Retain(context.Background(), claim, p) != ErrUnavailable {
		t.Fatal("write retry before read")
	}
	retained, err := c.Reconcile(context.Background(), claim, p)
	if err != nil || retained {
		t.Fatal("absent read failed")
	}
	if c.Retry(context.Background(), claim, p) != nil || len(bodies) != 2 || !bytes.Equal(bodies[0], bodies[1]) {
		t.Fatal("retry changed exact operation/context/body")
	}
	claim.Generation++
	if _, err := c.Reconcile(context.Background(), claim, p); err != ErrUnavailable || len(bodies) != 2 {
		t.Fatal("cross-generation replay contacted sink")
	}
}
func TestATMOutboxDeepCopiesTamperAndTargetChecks(t *testing.T) {
	c := testClient(t)
	evidence := fixtureEvidence()
	p, err := c.Prepare(evidence)
	if err != nil {
		t.Fatal(err)
	}
	*evidence.Captures[0].ExitCode = 9
	evidence.Captures[0].StderrBase64 = "changed"
	if !c.same(p) {
		t.Fatal("source mutation changed sealed receipt")
	}
	opened, err := c.Open(p.envelope.OperationID)
	if err != nil || !bytes.Equal(opened.body, p.body) {
		t.Fatal("exact reopen failed")
	}
	if err := c.Retain(context.Background(), protocol.Claim{}, opened); err != ErrUnavailable {
		t.Fatal("reopen bypassed reconciliation")
	}
	raw, _ := os.ReadFile(p.path)
	_ = os.WriteFile(p.path, append(raw, ' '), 0600)
	if c.same(p) {
		t.Fatal("whitespace-tampered receipt acknowledged")
	}
	_ = os.WriteFile(p.path, raw, 0600)
	c.config.Endpoint = "http://127.0.0.1:3152"
	if c.same(p) {
		t.Fatal("prepared replay redirected to changed endpoint")
	}
}
func TestATMCapacityExpiryAndInvalidConfigDoNoHTTP(t *testing.T) {
	c := testClient(t)
	c.config.MaxOutboxFiles = 1
	if _, err := c.Prepare(fixtureEvidence()); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Prepare(fixtureEvidence()); err != ErrUnavailable {
		t.Fatal("capacity default/overflow")
	}
	c = testClient(t)
	c.config.MaxCaptureBytes = 1
	if _, err := c.Prepare(fixtureEvidence()); err != ErrUnavailable {
		t.Fatal("raw capture capacity ignored")
	}
	c = testClient(t)
	c.expires = time.Now().Add(-time.Second)
	if _, err := c.Prepare(fixtureEvidence()); err != ErrUnavailable {
		t.Fatal("expired policy accepted")
	}
	for _, endpoint := range []string{"http://127.0.0.1", "http://localhost:3151", "https://remote.example:443", "http://127.0.0.1:3151/", "http://127.0.0.1:3151?host=remote"} {
		c = testClient(t)
		c.config.Endpoint = endpoint
		if c.available() {
			t.Fatal("unapproved endpoint", endpoint)
		}
	}
	if c, err := Load(""); err != nil || c != nil {
		t.Fatal("missing configuration enabled sink")
	}
}
func TestATMResolveRejectsBodyDriftAndSnapshotSubstitution(t *testing.T) {
	s, claim, binding := fixture()
	for _, mode := range []string{"extra", "null", "duplicate", "wrong-team-context", "resource"} {
		c := testClient(t)
		c.http.Transport = fakeHTTP(func(r *http.Request) (*http.Response, error) {
			raw, _ := json.Marshal(binding)
			switch mode {
			case "extra":
				raw = append(raw[:len(raw)-1], []byte(`,"extra":true}`)...)
			case "null":
				raw = []byte(`null`)
			case "duplicate":
				raw = append(raw[:len(raw)-1], []byte(`,"version":1}`)...)
			case "wrong-team-context":
				binding.JobID = "33333333-3333-4333-8333-333333333333"
				binding.ContextDigest, _ = binding.Digest()
				raw, _ = json.Marshal(binding)
			case "resource":
				binding.ResourcePolicyDigest = strings.Repeat("b", 64)
				binding.ContextDigest, _ = binding.Digest()
				raw, _ = json.Marshal(binding)
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw))}, nil
		})
		if _, err := c.Resolve(context.Background(), claim, s); err == nil {
			t.Fatal("context substitution accepted", mode)
		}
	}
}

func TestATMExpiryClampsHTTPRequestAndDiscardsLateAck(t *testing.T) {
	for _, mode := range []string{"resolve", "retain", "acknowledge"} {
		t.Run(mode, func(t *testing.T) {
			c := testClient(t)
			s, claim, binding := fixture()
			p, err := c.Prepare(fixtureEvidence())
			if err != nil {
				t.Fatal(err)
			}
			c.expires = time.Now().Add(30 * time.Millisecond)
			c.config.ExpiresAt = c.expires.UTC().Format(time.RFC3339Nano)
			calls := 0
			c.http.Transport = fakeHTTP(func(r *http.Request) (*http.Response, error) {
				calls++
				deadline, ok := r.Context().Deadline()
				if !ok || deadline.After(c.expires) {
					t.Fatal("request outlived original configuration expiry")
				}
				raw, _ := io.ReadAll(r.Body)
				<-r.Context().Done()
				if mode == "resolve" {
					return response(binding), nil
				}
				return response(ackFor(raw, "retained")), nil
			})
			switch mode {
			case "resolve":
				if _, err := c.Resolve(context.Background(), claim, s); err != ErrUnavailable {
					t.Fatal("expired context permitted execution")
				}
			case "retain":
				if err := c.Retain(context.Background(), claim, p); err != ErrUnknown {
					t.Fatal("late retain became acknowledged or definitive failure", err)
				}
			case "acknowledge":
				if err := c.Acknowledge(context.Background(), claim, fixtureEvidence()); err != ErrUnknown {
					t.Fatal("late ack permitted binary grade", err)
				}
			}
			if calls != 1 {
				t.Fatal("expired receipt caused extra request", calls)
			}
		})
	}
}
