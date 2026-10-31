package main

import (
	"context"
	"encoding/json"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/atm"
	"nextera.local/runner/internal/executor"
	"nextera.local/runner/internal/protocol"
	"strings"
	"testing"
)

type fakeATMSink struct {
	binding            *atm.Context
	err                error
	resolved, retained int
	onAck              func()
}

func (f *fakeATMSink) Resolve(context.Context, protocol.Claim, protocol.Snapshot) (*atm.Context, error) {
	f.resolved++
	return f.binding, nil
}
func (f *fakeATMSink) Acknowledge(_ context.Context, _ protocol.Claim, e atm.Evidence) error {
	f.retained++
	if f.onAck != nil {
		f.onAck()
	}
	return f.err
}
func workATMFixture() (protocol.Snapshot, protocol.Claim, atm.Context) {
	id := "11111111-1111-4111-8111-111111111111"
	h := strings.Repeat("a", 64)
	environment := artifact.Environment{Sandbox: "sha256:" + h, Toolchain: artifact.Toolchain, Platform: artifact.Platform, Flags: []string{"-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid="}, Dependencies: "offline", Profile: artifact.Profile, Resources: artifact.PilotResources(), Protocol: 1, Snapshot: 1, Generation: artifact.Generation{Mode: "static"}}
	s := protocol.Snapshot{PackID: "atm-v1", CurriculumID: id, Node: "week1-atm", Cohort: id, Submission: id, SpecDigest: h, Source: protocol.Source{Digest: h}, VerifiedJob: id, VerifiedJudgeAttempt: id, VerifiedWorker: id, VerifiedGeneration: 1, VerifiedDigest: h, Entry: artifact.Entry{Contract: &artifact.ExecutionContract{Version: 4, Item: "week1-atm", File: "main.go", Input: "stdin_utf8", Output: "atm_report_events_v1"}, SemanticProfileDigest: json.RawMessage(`"` + atm.SemanticProfileDigest + `"`), Digest: h, Runner: "sha256:" + h, Environment: environment}}
	cl := protocol.Claim{Job: id, Attempt: id, Worker: id, Token: id, Generation: 1, Digest: h}
	resource, _ := atm.ResourceDigest(environment)
	c := atm.Context{Version: 1, JobID: id, JudgeAttemptID: id, WorkerID: id, Generation: "1", SubmissionID: id, RaidAttemptID: id, TeamID: id, CohortID: id, CurriculumVersionID: id, NodeKey: s.Node, SourceSHA256: h, EvaluationSnapshotDigest: h, EvaluationSpecDigest: h, DefinitionDigest: h, TestPackID: s.PackID, TestPackDigest: h, SemanticProfileDigest: atm.SemanticProfileDigest, RunnerImageDigest: s.Runner, ResourcePolicyDigest: resource, ModelID: atm.ModelID, CaseCount: 1}
	c.ContextDigest, _ = c.Digest()
	return s, cl, c
}
func workATMEvidence(c atm.Context) *atm.Evidence {
	zero := 0
	return &atm.Evidence{Context: c, StopVerified: true, Captures: []atm.Capture{{ExitCode: &zero, TransportWriteComplete: true, StdinHalfClosed: true, OutputComplete: true, Termination: "exited", Assessment: "observations_match"}}}
}
func TestATMWorkloopRequiresContextAndDurableAckBeforeAnyGrade(t *testing.T) {
	s, cl, binding := workATMFixture()
	for _, mode := range []string{"missing", "retained", "unknown", "unavailable", "stop", "incomplete", "mismatch-without-ack"} {
		t.Run(mode, func(t *testing.T) {
			sink := &fakeATMSink{binding: &binding}
			var configured atmEvidenceSink = sink
			if mode == "missing" {
				configured = nil
			}
			if mode == "unknown" {
				sink.err = atm.ErrUnknown
			}
			if mode == "unavailable" || mode == "mismatch-without-ack" {
				sink.err = atm.ErrUnavailable
			}
			evaluations := 0
			result, mayPersist := evaluationWithEvidence(context.Background(), cl, s, "private-layout", configured, func(_ context.Context, _ protocol.Snapshot, _ string, c *atm.Context) executor.Result {
				evaluations++
				if c == nil || c.RaidAttemptID != binding.RaidAttemptID {
					t.Fatal("context absent/inferred")
				}
				evidence := workATMEvidence(*c)
				if mode == "stop" {
					evidence.StopVerified = false
				}
				if mode == "incomplete" {
					evidence.Captures = nil
				}
				verdict := "passed"
				if mode == "mismatch-without-ack" {
					verdict = "failed"
					evidence.Captures[0].Assessment = "projection_mismatch"
				}
				return executor.Result{Verdict: verdict, ATM: evidence}
			})
			if mode == "retained" {
				if result.Verdict != "passed" || !mayPersist || sink.retained != 1 {
					t.Fatal("acknowledged evidence discarded")
				}
			} else if result.Verdict != "system_error" || mayPersist != (mode != "unknown") {
				t.Fatal("missing/unknown evidence became grade", result.Verdict, mayPersist)
			}
			if mode == "missing" && evaluations != 0 {
				t.Fatal("disabled sink executed learner")
			}
			if (mode == "stop" || mode == "incomplete") && sink.retained != 0 {
				t.Fatal("pre-stop/incomplete success was retained")
			}
		})
	}
}
func TestATMMixedCatalogLegacyJobsStayIndependent(t *testing.T) {
	for _, version := range []int{1, 2, 3} {
		s, cl, _ := workATMFixture()
		s.Contract.Version = version
		calls := 0
		result, mayPersist := evaluationWithEvidence(context.Background(), cl, s, "legacy", nil, func(_ context.Context, _ protocol.Snapshot, _ string, c *atm.Context) executor.Result {
			calls++
			if c != nil {
				t.Fatal("legacy acquired ATM context")
			}
			return executor.Result{Verdict: "passed", Metrics: map[string]int64{"legacy": 1}}
		})
		if result.Verdict != "passed" || !mayPersist || calls != 1 || result.Metrics["legacy"] != 1 {
			t.Fatal("ABI4 configuration changed legacy")
		}
	}
}
func TestATMWorkloopRejectsSubstitutedContextBeforeExecution(t *testing.T) {
	s, cl, binding := workATMFixture()
	binding.SourceSHA256 = strings.Repeat("b", 64)
	binding.ContextDigest, _ = binding.Digest()
	sink := &fakeATMSink{binding: &binding}
	called := false
	result, _ := evaluationWithEvidence(context.Background(), cl, s, "layout", sink, func(context.Context, protocol.Snapshot, string, *atm.Context) executor.Result {
		called = true
		return executor.Result{Verdict: "passed"}
	})
	if called || sink.retained != 0 || result.Verdict != "system_error" {
		t.Fatal("substituted frozen source executed")
	}
}

func TestATMWorkloopRenewalCancellationDuringAckPreventsPublication(t *testing.T) {
	s, cl, binding := workATMFixture()
	ctx, cancel := context.WithCancel(context.Background())
	sink := &fakeATMSink{binding: &binding, onAck: cancel}
	result, mayPersist := evaluationWithEvidence(ctx, cl, s, "layout", sink, func(context.Context, protocol.Snapshot, string, *atm.Context) executor.Result {
		return executor.Result{Verdict: "passed", ATM: workATMEvidence(binding)}
	})
	if mayPersist || result.Verdict != "system_error" {
		t.Fatal("lease-loss cancellation allowed stale grade")
	}
}
func TestATMInfrastructureUsesOnlyExistingNativeFailureCodes(t *testing.T) {
	s, cl, binding := workATMFixture()
	missing, _ := evaluationWithEvidence(context.Background(), cl, s, "layout", nil, nil)
	if missing.Code != "INCOMPATIBLE_ENVIRONMENT" {
		t.Fatal("new code would be rejected by record_outcome")
	}
	sink := &fakeATMSink{binding: &binding}
	result, mayPersist := evaluationWithEvidence(context.Background(), cl, s, "layout", sink, func(context.Context, protocol.Snapshot, string, *atm.Context) executor.Result {
		evidence := workATMEvidence(binding)
		evidence.Captures[0].Assessment = "capture_unavailable"
		return executor.Result{Verdict: "system_error", Code: "ATM_CAPTURE_UNAVAILABLE", ATM: evidence}
	})
	if !mayPersist || result.Verdict != "system_error" || result.Code != "CONTAINER_FAILURE" {
		t.Fatal("captured infrastructure became invalid native failure")
	}
}
