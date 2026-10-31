package main

import (
	"context"
	"errors"
	"io"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/executor"
	"nextera.local/runner/internal/functional"
	"nextera.local/runner/internal/protocol"
	"os"
	"strings"
	"testing"
	"time"
)

type fakeFunctionalPrepared struct {
	calls int
	err   error
}

func (p *fakeFunctionalPrepared) OperationID() string           { return "00000000-0000-0000-0000-000000000099" }
func (p *fakeFunctionalPrepared) Publish(context.Context) error { p.calls++; return p.err }

type fakeFunctionalPublisher struct {
	calls    int
	prepared *fakeFunctionalPrepared
	err      error
	report   *protocol.FunctionalReport
}

func (p *fakeFunctionalPublisher) PublicationContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, time.Second)
}
func (p *fakeFunctionalPublisher) Prepare(ctx context.Context, r *protocol.FunctionalReport) (functionalPrepared, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	p.calls++
	p.report = r
	return p.prepared, p.err
}
func captureFunctionalLog(t *testing.T, fn func()) string {
	t.Helper()
	old := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	defer func() { os.Stdout = old; reader.Close(); writer.Close() }()
	fn()
	writer.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func TestFunctionalWorkHandoffKeepsUnknownEnvelopeForExplicitReplayOnly(t *testing.T) {
	snapshot := protocol.Snapshot{Entry: artifact.Entry{Contract: &artifact.ExecutionContract{Version: 3, Item: "q1"}}}
	claim := &protocol.Claim{Job: "00000000-0000-0000-0000-000000000001"}
	report := &protocol.FunctionalReport{Version: 1, Groups: []protocol.FunctionalGroup{{GroupKey: "synthetic", Passed: false}}}
	for _, err := range []error{nil, functional.ErrUnknown, functional.ErrDenied} {
		prepared := &fakeFunctionalPrepared{err: err}
		publisher := &fakeFunctionalPublisher{prepared: prepared}
		logs := captureFunctionalLog(t, func() {
			publishFunctional(context.Background(), publisher, claim, snapshot, executor.Result{Verdict: "failed", Functional: report})
		})
		if publisher.calls != 1 || prepared.calls != 1 || publisher.report != report {
			t.Fatal("handoff dropped partial report or automatically rebound/retried")
		}
		if errors.Is(err, functional.ErrUnknown) && (!strings.Contains(logs, "functional_publication_unknown") || !strings.Contains(logs, prepared.OperationID())) {
			t.Fatal("unknown operation not retained for explicit exact replay", logs)
		}
		for _, private := range []string{"synthetic", `"groups"`, `"passed"`, "criteriaDigest", "artifactSha256", "database", "expected"} {
			if strings.Contains(logs, private) {
				t.Fatal("private result or credential leaked to log", logs)
			}
		}
	}
}
func TestFunctionalWorkDoesNotPublishMissingManifestOrIncompleteObservations(t *testing.T) {
	snapshot := protocol.Snapshot{Entry: artifact.Entry{Contract: &artifact.ExecutionContract{Version: 3, Item: "q1"}}}
	publisher := &fakeFunctionalPublisher{prepared: &fakeFunctionalPrepared{}}
	for _, cause := range []string{"manifest_missing", "observed_compiler_nonzero", "compilation_unobserved", "execution_unobserved", "infrastructure_unknown"} {
		captureFunctionalLog(t, func() {
			publishFunctional(context.Background(), publisher, &protocol.Claim{}, snapshot, executor.Result{Verdict: "failed", FunctionalUnavailable: cause})
		})
	}
	snapshot.Contract.Item = "q8"
	captureFunctionalLog(t, func() {
		publishFunctional(context.Background(), publisher, &protocol.Claim{}, snapshot, executor.Result{Functional: &protocol.FunctionalReport{Version: 1}})
	})
	if publisher.calls != 0 {
		t.Fatal("missing observations or unsupported q8 triggered native publication")
	}
}

func TestFunctionalAcknowledgedResultJoinsRenewalAndPublishesOnIndependentBoundedParent(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	defer cancelParent()
	formerLease, stopRenewal := context.WithCancel(parent)
	joined := make(chan struct{})
	go func() { <-formerLease.Done(); close(joined) }()
	prepared := &fakeFunctionalPrepared{err: functional.ErrUnknown}
	publisher := &fakeFunctionalPublisher{prepared: prepared}
	snapshot := protocol.Snapshot{Entry: artifact.Entry{Contract: &artifact.ExecutionContract{Version: 3, Item: "q1"}}}
	result := executor.Result{Verdict: "failed", Functional: &protocol.FunctionalReport{Version: 1}}
	logs := captureFunctionalLog(t, func() {
		publishAfterAcknowledgement(parent, stopRenewal, joined, publisher, &protocol.Claim{}, snapshot, result)
	})
	if formerLease.Err() == nil || parent.Err() != nil || publisher.calls != 1 || prepared.calls != 1 || !strings.Contains(logs, "functional_publication_unknown") {
		t.Fatal("lease completion cancelled acknowledged evidence before outbox/replay", logs)
	}
	// Parent cancellation remains authoritative; do not publish after shutdown.
	cancelParent()
	captureFunctionalLog(t, func() {
		publishAfterAcknowledgement(parent, stopRenewal, joined, publisher, &protocol.Claim{}, snapshot, result)
	})
	if publisher.calls != 1 || prepared.calls != 1 {
		t.Fatal("publication escaped actual parent cancellation")
	}
}
