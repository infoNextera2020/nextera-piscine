package sandbox

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

// Protected local engine probe, independent of any private Judge input.
func TestActualEngineStreamAndCancellation(t *testing.T) {
	if os.Getenv("NEXTERA_SANDBOX_INTEGRATION") != "1" {
		t.Skip("explicit protected-host opt-in required")
	}
	e := New(Socket())
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	c, err := e.Create(ctx, os.Getenv("NEXTERA_SANDBOX_IMAGE"), false)
	if err != nil {
		t.Fatal("effective sandbox policy unavailable")
	}
	defer c.Close()
	if err = c.Import(ctx, map[string][]byte{"public.txt": []byte("public fixture")}); err != nil {
		t.Fatal("bounded import failed")
	}
	out, stderr, code, err := c.Exec(ctx, []string{"/bin/cat", "/workspace/public.txt"}, nil, nil, 65536)
	if err != nil || code != 0 || len(stderr) != 0 || string(out) != "public fixture" {
		t.Fatal("Docker stream/import contract failed")
	}
	short, stop := context.WithTimeout(ctx, 500*time.Millisecond)
	defer stop()
	_, _, _, err = c.Exec(short, []string{"/bin/sh", "-c", "while :; do :; done"}, nil, nil, 65536)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("phase cancellation did not fence the stream")
	}
}
