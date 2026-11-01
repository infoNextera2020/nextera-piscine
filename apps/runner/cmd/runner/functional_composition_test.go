package main

import (
	"context"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/executor"
	"nextera.local/runner/internal/protocol"
	"testing"
)

func TestFunctionalCompositionWithoutPublisherConfigDoesNotLoadEvaluator(t *testing.T) {
	lookups := 0
	queue, publisher, err := localConnections(true, "", func(name string) string {
		lookups++
		if name != "JUDGE_DATABASE_URL" {
			t.Fatal("omitted publisher configuration read an evaluator credential")
		}
		return "postgres://queue:synthetic@127.0.0.1:5432/foundation_test_unit?sslmode=disable"
	})
	if err != nil || queue == nil || publisher != nil || lookups != 1 {
		t.Fatal("functional publication became enabled without explicit configuration")
	}
}

func TestFunctionalCompositionPublishesOnlyAcknowledgedScoredCodingEvidence(t *testing.T) {
	type example struct {
		name      string
		version   int
		item      string
		contract  bool
		report    bool
		publisher bool
		verdict   string
		want      int
	}
	examples := []example{
		{"disabled", 3, "q1", true, true, false, "passed", 0},
		{"missing-contract", 0, "", false, true, true, "passed", 0},
		{"legacy-function", 1, "q1", true, true, true, "passed", 0},
		{"legacy-program", 2, "q1", true, true, true, "passed", 0},
		{"atm-program", 4, "q1", true, true, true, "passed", 0},
		{"trace-1", 3, "q6", true, true, true, "passed", 0},
		{"trace-2", 3, "q7", true, true, true, "passed", 0},
		{"debug", 3, "q8", true, true, true, "passed", 0},
		{"question-alias", 3, "q01", true, true, true, "passed", 0},
		{"missing-observations", 3, "q1", true, false, true, "failed", 0},
		{"infrastructure-error", 3, "q1", true, true, true, "system_error", 0},
		{"coding-1", 3, "q1", true, true, true, "passed", 1},
		{"coding-2", 3, "q2", true, true, true, "failed", 1},
		{"coding-3", 3, "q3", true, true, true, "passed", 1},
		{"coding-4", 3, "q4", true, true, true, "failed", 1},
		{"coding-5", 3, "q5", true, true, true, "passed", 1},
	}
	for _, example := range examples {
		t.Run(example.name, func(t *testing.T) {
			prepared := &fakeFunctionalPrepared{}
			fake := &fakeFunctionalPublisher{prepared: prepared}
			var publisher functionalPublisher
			if example.publisher {
				publisher = fake
			}
			var snapshot protocol.Snapshot
			if example.contract {
				snapshot.Entry = artifact.Entry{Contract: &artifact.ExecutionContract{Version: example.version, Item: example.item}}
			}
			result := executor.Result{Verdict: example.verdict}
			if example.report {
				result.Functional = &protocol.FunctionalReport{Version: 1, ItemKey: example.item}
			}
			joined := make(chan struct{})
			stops := 0
			stop := func() { stops++; close(joined) }
			captureFunctionalLog(t, func() {
				publishAfterAcknowledgement(context.Background(), stop, joined, publisher, &protocol.Claim{}, snapshot, result)
			})
			if stops != 1 || fake.calls != example.want || prepared.calls != example.want {
				t.Fatal("acknowledged handoff changed its scope, lease join or single-write boundary")
			}
		})
	}
}
