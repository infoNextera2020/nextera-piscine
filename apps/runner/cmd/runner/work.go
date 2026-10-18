package main

import (
	"context"
	"encoding/json"
	"flag"
	"io"
	"net/url"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/executor"
	"nextera.local/runner/internal/protocol"
	"nextera.local/runner/internal/queue"
	"nextera.local/runner/internal/sandbox"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

func logEvent(event string, cl *protocol.Claim, verdict string) {
	data := map[string]any{"event": event}
	if cl != nil {
		data["job_id"] = cl.Job
		data["attempt_id"] = cl.Attempt
		data["evaluation_digest"] = cl.Digest
	}
	if verdict != "" {
		data["verdict"] = verdict
	}
	_ = json.NewEncoder(os.Stdout).Encode(data)
}
func work(args []string) error {
	if runtime.Version() != artifact.Toolchain || runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		return artifact.ErrInvalid
	}
	flags := flag.NewFlagSet("work", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	candidate := flags.String("candidate", "", "protected candidate metadata")
	layouts := flags.String("layouts", "", "protected local OCI directory")
	image := flags.String("runner-image", "", "actual Runner OCI manifest digest")
	storage := flags.String("storage-url", "", "Supabase Storage endpoint")
	token := flags.String("storage-token-file", "", "read-only Storage credential file")
	local := flags.Bool("local-fixtures", false, "disposable fixture database only")
	once := flags.Bool("once", false, "process at most one job")
	if flags.Parse(args) != nil || flags.NArg() != 0 {
		return artifact.ErrInvalid
	}
	database := os.Getenv("JUDGE_DATABASE_URL")
	if *local {
		u, e := url.Parse(database)
		if e != nil || !(u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost") || !strings.HasPrefix(u.Path, "/foundation_test") {
			return artifact.ErrInvalid
		}
	} else {
		return artifact.ErrInvalid
	} // Private registry deployment is not approved by Foundation 004.
	catalog, err := artifact.ReadCandidate(*candidate)
	if err != nil {
		return err
	}
	for _, entry := range catalog.Packs {
		if entry.Runner != *image {
			return artifact.ErrInvalid
		}
	}
	if revision == "working-tree" || revision == "" {
		return artifact.ErrInvalid
	}
	engine := sandbox.New(sandbox.Socket())
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if engine.VerifyImage(ctx, *image) != nil {
		if ctx.Err() != nil {
			return nil
		}
		return artifact.ErrInvalid
	}
	// The retained build receipt binds the executing binary revision to the verified OCI image.
	var receipt map[string]struct {
		Manifest string `json:"manifest"`
		Source   string `json:"source_digest"`
	}
	raw, err := os.ReadFile(filepath.Join(*layouts, "local-images.json"))
	if err != nil || json.Unmarshal(raw, &receipt) != nil || receipt["runner"].Manifest != *image || receipt["runner"].Source != revision {
		return artifact.ErrInvalid
	}
	client := queue.Client{URL: database}
	evaluator := executor.Executor{Engine: engine, StorageURL: *storage, TokenFile: *token}
	if client.Heartbeat(ctx) != nil || engine.Cleanup(ctx) != nil {
		if ctx.Err() != nil {
			return nil
		}
		return artifact.ErrInvalid
	}
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = client.Heartbeat(ctx)
				_ = engine.Cleanup(ctx)
			}
		}
	}()
	for ctx.Err() == nil {
		claim, e := client.Claim(ctx)
		if e != nil {
			if ctx.Err() != nil {
				return nil
			}
			return artifact.ErrInvalid
		}
		if claim == nil {
			if *once {
				return nil
			}
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(time.Second):
				continue
			}
		}
		logEvent("job_claimed", claim, "")
		jobEngine := *engine
		jobEngine.Job = claim.Job
		jobEngine.Attempt = claim.Attempt
		if jobEngine.Cleanup(ctx) != nil {
			if ctx.Err() != nil {
				return nil
			}
			return artifact.ErrInvalid
		}
		evaluator.Engine = &jobEngine
		runCtx, cancel := context.WithCancel(ctx)
		renewalDone := make(chan struct{})
		go func() {
			defer close(renewalDone)
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-runCtx.Done():
					return
				case <-ticker.C:
					if client.Renew(runCtx, claim) != nil {
						logEvent("lease_lost", claim, "")
						cancel()
						return
					}
					logEvent("lease_renewed", claim, "")
				}
			}
		}()
		snapshot, layout, verifyErr := protocol.Verify(*claim, catalog, *image, *layouts, *local)
		result := executor.Result{Verdict: "system_error", Code: "INCOMPATIBLE_ENVIRONMENT", Metrics: map[string]int64{}}
		if verifyErr == nil {
			if client.Start(runCtx, claim) != nil {
				cancel()
				<-renewalDone
				logEvent("lease_lost", claim, "")
				if *once {
					return nil
				}
				continue
			}
			logEvent("evaluation_started", claim, "")
			result = evaluator.Evaluate(runCtx, snapshot, layout)
		}
		if runCtx.Err() == nil {
			// Identical replay handles an ambiguous commit/connection loss. Never replace a
			// learner outcome with an infrastructure error just because acknowledgement failed.
			var persistErr error
			for replay := 0; replay < 3; replay++ {
				if result.Verdict == "system_error" {
					persistErr = client.Failure(runCtx, claim, result.Code)
				} else {
					persistErr = client.Result(runCtx, claim, result.Verdict, result.Metrics)
				}
				if persistErr == nil {
					break
				}
				select {
				case <-runCtx.Done():
				case <-time.After(time.Second):
				}
			}
			if persistErr == nil {
				event := "evaluation_completed"
				if result.Verdict == "system_error" {
					event = "system_failure"
				}
				logEvent(event, claim, result.Verdict)
			} else {
				logEvent("lease_lost", claim, "")
			}
		}
		cancel()
		<-renewalDone
		if *once {
			return nil
		}
	}
	return nil
}
