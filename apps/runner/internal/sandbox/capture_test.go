package sandbox

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

type captureTransport func(*http.Request) (*http.Response, error)

func (f captureTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type captureConn struct {
	reader          *bytes.Reader
	writes          int
	short, halfFail bool
}

func (c *captureConn) Read(b []byte) (int, error) { return c.reader.Read(b) }
func (c *captureConn) Write(b []byte) (int, error) {
	c.writes++
	if c.writes > 1 && c.short && len(b) > 0 {
		return len(b) - 1, nil
	}
	return len(b), nil
}
func (c *captureConn) CloseWrite() error {
	if c.halfFail {
		return io.ErrClosedPipe
	}
	return nil
}
func (c *captureConn) Close() error                     { return nil }
func (c *captureConn) LocalAddr() net.Addr              { return nil }
func (c *captureConn) RemoteAddr() net.Addr             { return nil }
func (c *captureConn) SetDeadline(time.Time) error      { return nil }
func (c *captureConn) SetReadDeadline(time.Time) error  { return nil }
func (c *captureConn) SetWriteDeadline(time.Time) error { return nil }
func captureFrame(stream byte, b []byte) []byte {
	h := make([]byte, 8)
	h[0] = stream
	binary.BigEndian.PutUint32(h[4:], uint32(len(b)))
	return append(h, b...)
}
func captureFake(status string, frames []byte, short, halfFail bool) (*Container, func(context.Context) (net.Conn, error)) {
	id := strings.Repeat("a", 64)
	engine := &Engine{HTTP: &http.Client{Transport: captureTransport(func(r *http.Request) (*http.Response, error) {
		body := `{"Id":"` + id + `"}`
		if r.Method == "GET" {
			body = status
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}}
	conn := &captureConn{reader: bytes.NewReader(append([]byte("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n"), frames...)), short: short, halfFail: halfFail}
	return &Container{E: engine, ID: "container"}, func(context.Context) (net.Conn, error) { return conn, nil }
}
func TestATMCapturedTransportRequiresFullAcknowledgement(t *testing.T) {
	status := `{"ID":"` + strings.Repeat("a", 64) + `","Running":false,"ExitCode":0}`
	for _, input := range []string{"", "exact\r\n"} {
		c, dial := captureFake(status, append(captureFrame(1, []byte("report")), captureFrame(2, []byte("human words"))...), false, false)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		got, err := c.execCaptured(ctx, []string{"/workspace/program"}, nil, []byte(input), 17, dial)
		cancel()
		if err != nil || !got.TransportWriteComplete || !got.StdinHalfClosed || !got.OutputComplete || got.ExitCode == nil || *got.ExitCode != 0 || string(got.Stdout) != "report" || string(got.Stderr) != "human words" {
			t.Fatal("complete capture unavailable", err)
		}
	}
	for _, row := range []struct{ short, half bool }{{true, false}, {false, true}} {
		c, dial := captureFake(status, captureFrame(1, []byte("x")), row.short, row.half)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		got, err := c.execCaptured(ctx, nil, nil, []byte("input"), 32, dial)
		cancel()
		if err == nil || got.OutputComplete || got.ExitCode != nil {
			t.Fatal("unacknowledged stdin became complete")
		}
	}
}
func TestATMCapturedFramingAndStatusPresence(t *testing.T) {
	id := strings.Repeat("a", 64)
	valid := `{"ID":"` + id + `","Running":false,"ExitCode":0}`
	for _, status := range []string{`{}`, `{"ID":"` + id + `","Running":false}`, `{"ID":"` + id + `","ExitCode":0}`, `{"ID":"` + id + `","Running":true,"ExitCode":0}`, `{"ID":"` + id + `","Running":false,"ExitCode":256}`, `{"ID":"other","Running":false,"ExitCode":0}`} {
		c, dial := captureFake(status, nil, false, false)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		got, err := c.execCaptured(ctx, nil, nil, nil, 32, dial)
		cancel()
		if err == nil || got.ExitCode != nil || got.OutputComplete {
			t.Fatal("missing/unknown native status became exit zero")
		}
	}
	badReserved := captureFrame(1, nil)
	badReserved[1] = 1
	for _, frames := range [][]byte{{1, 0, 0}, captureFrame(3, []byte("x")), badReserved, append(captureFrame(1, []byte("secret")), 1), captureFrame(1, bytes.Repeat([]byte("x"), 33))} {
		c, dial := captureFake(valid, frames, false, false)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		got, err := c.execCaptured(ctx, nil, nil, nil, 32, dial)
		cancel()
		if err == nil || got.OutputComplete || got.ExitCode != nil {
			t.Fatal("bad frame/cap became complete")
		}
	}
	for _, status := range []string{valid + ` {"Running":true}`, strings.TrimSuffix(valid, "}") + `,"Running":true}`, strings.TrimSuffix(valid, "}") + `,"ExitCode":1}`, `{"ID":"` + id + `","Running":null,"ExitCode":0}`, `{"ID":"` + id + `","Running":false,"ExitCode":null}`} {
		c, dial := captureFake(status, nil, false, false)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		got, err := c.execCaptured(ctx, nil, nil, nil, 32, dial)
		cancel()
		if err == nil || got.OutputComplete || got.ExitCode != nil {
			t.Fatal("ambiguous/trailing native status became known exit")
		}
	}
}
func TestATMCapturedNoUnboundedContext(t *testing.T) {
	c, dial := captureFake("{}", nil, false, false)
	if _, err := c.execCaptured(context.Background(), nil, nil, nil, 32, dial); err == nil {
		t.Fatal("missing deadline accepted")
	}
}

func TestATMCapturedControlStdoutCannotOverrideAmbiguousInspect(t *testing.T) {
	valid := `{"ID":"` + strings.Repeat("a", 64) + `","Running":false,"ExitCode":0}`
	for _, status := range []string{`{}`, strings.TrimSuffix(valid, "}") + `,"ExitCode":1}`, valid + ` {"ExitCode":0}`} {
		for _, command := range [][]string{{"/bin/tar", "--no-same-owner", "-xf", "-", "-C", "/workspace"}, {"/bin/chmod", "500", "/workspace/program"}, {"/bin/cat", "/sys/fs/cgroup/memory.events"}, {"/usr/bin/stat", "-f", "-c", "%a %d", "/workspace", "/tmp", "/dev/shm"}, {"/bin/sh", "-c", "trusted compiler command"}} {
			c, dial := captureFake(status, captureFrame(1, []byte("oom_kill 0\n10 10 10 10 10 10\n")), false, false)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			got, err := c.execCaptured(ctx, command, nil, nil, 65536, dial)
			cancel()
			if err == nil || got.OutputComplete || got.ExitCode != nil {
				t.Fatal("plausible control output overrode unknown terminal evidence")
			}
		}
	}
}
