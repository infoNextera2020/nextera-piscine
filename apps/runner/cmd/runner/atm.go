package main

import (
	"context"
	"errors"
	"nextera.local/runner/internal/atm"
	"nextera.local/runner/internal/executor"
	"nextera.local/runner/internal/protocol"
)

type atmEvidenceSink interface {
	Resolve(context.Context, protocol.Claim, protocol.Snapshot) (*atm.Context, error)
	Acknowledge(context.Context, protocol.Claim, atm.Evidence) error
}
type evaluateATMJob func(context.Context, protocol.Snapshot, string, *atm.Context) executor.Result

// The actual workloop uses this handoff before any binary result write. Queue
// attempts/generations never stand in for the authoritative shared Raid attempt.
func evaluationWithEvidence(ctx context.Context, claim protocol.Claim, snapshot protocol.Snapshot, layout string, sink atmEvidenceSink, evaluate evaluateATMJob) (executor.Result, bool) {
	unavailable := func() (executor.Result, bool) {
		return executor.Result{Verdict: "system_error", Code: "INCOMPATIBLE_ENVIRONMENT", Metrics: map[string]int64{}}, true
	}
	if snapshot.Contract == nil || snapshot.Contract.Version != 4 {
		return evaluate(ctx, snapshot, layout, nil), true
	}
	if ctx.Err() != nil {
		result, _ := unavailable()
		return result, false
	}
	if sink == nil {
		return unavailable()
	}
	binding, err := sink.Resolve(ctx, claim, snapshot)
	if err != nil || binding == nil || !binding.Bound(snapshot) {
		return unavailable()
	}
	copy := *binding
	result := evaluate(ctx, snapshot, layout, &copy)
	if result.ATM == nil || !result.ATM.StopVerified {
		return unavailable()
	}
	if result.Verdict == "passed" && !result.ATM.CompleteMatch() {
		return unavailable()
	}
	if err = sink.Acknowledge(ctx, claim, result.ATM.Clone()); err != nil {
		if errors.Is(err, atm.ErrUnknown) {
			result, _ = unavailable()
			return result, false
		}
		return unavailable()
	}
	if ctx.Err() != nil {
		result, _ = unavailable()
		return result, false
	}
	// Native record_infrastructure_failure has a closed existing code set.
	// Private capture detail must never widen that authority or become a grade.
	if result.Verdict == "system_error" {
		result.Code = "CONTAINER_FAILURE"
	}
	return result, true
}
