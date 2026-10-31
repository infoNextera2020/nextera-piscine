package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"github.com/jackc/pgx/v5"
	"io"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/executor"
	"nextera.local/runner/internal/functional"
	"nextera.local/runner/internal/localdb"
	"nextera.local/runner/internal/protocol"
	"os"
)

// localConnections is shared by work and replay. The explicit existing queue
// DSN is a target anchor only: evaluator credentials remain independent.
func localConnections(local bool, path string, getenv func(string) string) (*pgx.ConnConfig, functionalPublisher, error) {
	if !local {
		return nil, nil, artifact.ErrInvalid
	}
	config, target, err := localdb.Parse(getenv("JUDGE_DATABASE_URL"))
	if err != nil {
		return nil, nil, artifact.ErrInvalid
	}
	if path == "" {
		return config, nil, nil
	}
	protected, err := functional.LoadLocal(path, getenv, target)
	if err != nil {
		return nil, nil, artifact.ErrInvalid
	}
	return config, protectedFunctionalPublisher{publisher: protected}, nil
}

type functionalPrepared interface {
	OperationID() string
	Publish(context.Context) error
}
type functionalPublisher interface {
	Prepare(context.Context, *protocol.FunctionalReport) (functionalPrepared, error)
	PublicationContext(context.Context) (context.Context, context.CancelFunc)
}
type protectedFunctionalPublisher struct{ publisher *functional.Publisher }

func (p protectedFunctionalPublisher) PublicationContext(parent context.Context) (context.Context, context.CancelFunc) {
	return p.publisher.PublicationContext(parent)
}

func (p protectedFunctionalPublisher) Prepare(ctx context.Context, report *protocol.FunctionalReport) (functionalPrepared, error) {
	return p.publisher.Prepare(ctx, report)
}

// Acknowledged binary persistence clears its lease. Join renewal BEFORE
// publication, and never reuse the cancelled former lease context.
func publishAfterAcknowledgement(parent context.Context, stop context.CancelFunc, done <-chan struct{}, publisher functionalPublisher, claim *protocol.Claim, snapshot protocol.Snapshot, result executor.Result) {
	stop()
	<-done
	if publisher == nil || result.Verdict == "system_error" {
		return
	}
	publication, cancel := publisher.PublicationContext(parent)
	defer cancel()
	if publication.Err() != nil {
		functionalEvent("functional_publication_unavailable", claim, "")
		return
	}
	publishFunctional(publication, publisher, claim, snapshot, result)
}

// Only aggregate publication identity is logged. The immutable protected outbox
// retains exact operation/revision/payload for an explicit operator replay.
func functionalEvent(event string, claim *protocol.Claim, operation string) {
	data := map[string]any{"event": event}
	if claim != nil {
		data["job_id"] = claim.Job
		data["evaluation_digest"] = claim.Digest
	}
	if operation != "" {
		data["operation_id"] = operation
	}
	_ = json.NewEncoder(os.Stdout).Encode(data)
}
func publishFunctional(ctx context.Context, publisher functionalPublisher, claim *protocol.Claim, snapshot protocol.Snapshot, result executor.Result) {
	if publisher == nil || snapshot.Contract == nil || snapshot.Contract.Version != 3 || len(snapshot.Contract.Item) != 2 || snapshot.Contract.Item[0] != 'q' || snapshot.Contract.Item[1] < '1' || snapshot.Contract.Item[1] > '5' {
		return
	}
	if result.Functional == nil {
		functionalEvent("functional_evidence_unresolved", claim, "")
		return
	}
	prepared, err := publisher.Prepare(ctx, result.Functional)
	if err != nil {
		functionalEvent("functional_publication_unavailable", claim, "")
		return
	}
	// The native write is performed once. A lost acknowledgement leaves the
	// protected exact envelope for explicit replay, never an automatic new op.
	err = prepared.Publish(ctx)
	if err == nil {
		functionalEvent("functional_evidence_recorded", claim, prepared.OperationID())
		return
	}
	if errors.Is(err, functional.ErrUnknown) {
		functionalEvent("functional_publication_unknown", claim, prepared.OperationID())
		return
	}
	functionalEvent("functional_publication_unavailable", claim, prepared.OperationID())
}
func functionalReplay(args []string) error {
	flags := flag.NewFlagSet("functional-replay", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	config := flags.String("publisher-config", "", "explicit protected functional publisher configuration")
	operation := flags.String("operation", "", "original immutable operation UUID")
	local := flags.Bool("local-fixtures", false, "explicit existing local fixture queue target only")
	if flags.Parse(args) != nil || flags.NArg() != 0 || *config == "" || *operation == "" {
		return artifact.ErrInvalid
	}
	_, delivery, err := localConnections(*local, *config, os.Getenv)
	if err != nil {
		return artifact.ErrInvalid
	}
	protected, ok := delivery.(protectedFunctionalPublisher)
	if !ok || protected.publisher == nil {
		return artifact.ErrInvalid
	}
	publisher := protected.publisher
	ctx, cancel := publisher.PublicationContext(context.Background())
	defer cancel()
	if err = publisher.Replay(ctx, *operation); err != nil {
		functionalEvent("functional_replay_unresolved", nil, *operation)
		return artifact.ErrInvalid
	}
	functionalEvent("functional_replay_recorded", nil, *operation)
	return nil
}
