package main

import (
	"context"
	"encoding/json"
	"flag"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unicode/utf8"

	"nextera.local/runner/internal/publicrun"
	"nextera.local/runner/internal/sandbox"
)

type publicRunExecutor interface {
	Execute(context.Context, publicrun.Request) (publicrun.Outcome, error)
}
type publicRunFactory func(socket, image string) (publicRunExecutor, error)

// One public-only work envelope on stdin; no database, lease token, registry,
// grading pack, source path or storage credential is accepted by this command.
func publicRun(args []string) error {
	if runtime.Version() != "go1.27.2" || runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		return publicrun.ErrInvalid
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return publicRunStdio(ctx, args, os.Stdin, os.Stdout, func(socket, image string) (publicRunExecutor, error) {
		return publicrun.New(sandbox.New(socket), image)
	})
}

func publicRunStdio(ctx context.Context, args []string, input io.Reader, output io.Writer, factory publicRunFactory) error {
	fail := func() error {
		_ = json.NewEncoder(output).Encode(map[string]string{"error": "VISIBLE_RUN_UNAVAILABLE"})
		return publicrun.ErrInvalid
	}
	flags := flag.NewFlagSet("public-run-stdio", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	image := flags.String("runner-image", "", "operator-pinned local sandbox image digest")
	socket := flags.String("docker-socket", "", "operator-configured absolute Unix socket")
	if flags.Parse(args) != nil || flags.NArg() != 0 || factory == nil || ctx.Err() != nil || !filepath.IsAbs(*socket) || filepath.Clean(*socket) != *socket || *socket == "/" || len(*socket) > 4096 || strings.ContainsAny(*socket, "\x00\r\n") {
		return fail()
	}
	// Reject oversized/malformed work before constructing any socket client.
	type readResult struct {
		raw []byte
		err error
	}
	read := make(chan readResult, 1)
	go func() {
		raw, err := io.ReadAll(io.LimitReader(input, publicrun.MaxRequestBytes+1))
		read <- readResult{raw, err}
	}()
	var raw []byte
	select {
	case <-ctx.Done():
		if closer, ok := input.(io.Closer); ok {
			_ = closer.Close()
		}
		return fail()
	case got := <-read:
		if got.err != nil || ctx.Err() != nil {
			return fail()
		}
		raw = got.raw
	}
	request, err := publicrun.ParseRequest(raw)
	if err != nil || publicrun.Validate(request, *image) != nil {
		return fail()
	}
	executor, err := factory(*socket, *image)
	if err != nil || executor == nil {
		return fail()
	}
	result, err := executor.Execute(ctx, request)
	if err != nil || result.RunID != request.Work.RunID || result.IntentDigest != publicrun.IntentDigest(request.Work.Intent) || result.Generation != request.Generation || result.ExecutionID != request.ExecutionID {
		return fail()
	}
	switch result.State {
	case "completed", "compile_error", "runtime_error", "timeout", "output_limit", "system_error":
	default:
		return fail()
	}
	if result.State == "system_error" {
		result.Output = ""
	}
	if !utf8.ValidString(result.Output) || int64(len(result.Output)) > request.Work.Policy.Limits.OutputBytes {
		return fail()
	}
	if result.StoppedProof != nil && !publicrun.ValidDigest(*result.StoppedProof) {
		return fail()
	}
	if json.NewEncoder(output).Encode(result) != nil {
		return publicrun.ErrInvalid
	}
	return nil
}
