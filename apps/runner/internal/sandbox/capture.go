package sandbox

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"nextera.local/runner/internal/artifact"
	"regexp"
	"strings"
)

// ExecObservation attests transport and an explicitly inspected terminal status.
// A successful write and half-close do not prove the child read every byte.
// Bytes are private evidence, never product feedback or logs.
type ExecObservation struct {
	Stdout, Stderr                                          []byte
	ExitCode                                                *int
	TransportWriteComplete, StdinHalfClosed, OutputComplete bool
}

// A bounded control-plane reply must contain one unambiguous JSON object. The
// legacy API remains unchanged; normal additional Docker properties are allowed.
func (c *Container) captureAPI(ctx context.Context, method, path string, input any) (map[string]json.RawMessage, error) {
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return nil, ErrInfrastructure
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, body)
	if err != nil {
		return nil, ErrInfrastructure
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := c.E.HTTP.Do(req)
	if err != nil {
		return nil, ErrInfrastructure
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	var fields map[string]json.RawMessage
	if err != nil || len(raw) > 1<<20 || response.StatusCode < 200 || response.StatusCode >= 300 || artifact.Strict(raw, &fields) != nil || fields == nil {
		return nil, ErrInfrastructure
	}
	return fields, nil
}

func (c *Container) ExecCaptured(ctx context.Context, cmd, env []string, input []byte, cap int) (ExecObservation, error) {
	return c.execCaptured(ctx, cmd, env, input, cap, func(ctx context.Context) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", c.E.Socket)
	})
}

// Kept separate from Exec: ABI1/2/3 retain their exact established transport.
func (c *Container) execCaptured(ctx context.Context, cmd, env []string, input []byte, cap int, dial func(context.Context) (net.Conn, error)) (observation ExecObservation, failure error) {
	_, bounded := ctx.Deadline()
	if !bounded || ctx.Err() != nil || cap < 0 || c == nil || c.E == nil {
		return observation, ErrInfrastructure
	}
	input = bytes.Clone(input)
	created, createErr := c.captureAPI(ctx, "POST", "/containers/"+c.ID+"/exec", map[string]any{"AttachStdin": true, "AttachStdout": true, "AttachStderr": true, "Tty": false, "Cmd": cmd, "Env": env, "User": "65532:65532"})
	var createdID string
	if createErr != nil || json.Unmarshal(created["Id"], &createdID) != nil || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(createdID) {
		return observation, ErrInfrastructure
	}
	conn, err := dial(ctx)
	if err != nil {
		return observation, ErrInfrastructure
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	request, _ := http.NewRequest("POST", "http://docker/exec/"+createdID+"/start", strings.NewReader(`{"Detach":false,"Tty":false}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "tcp")
	if request.Write(conn) != nil {
		return observation, ErrInfrastructure
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, request)
	if err != nil || response.StatusCode != 101 {
		return observation, ErrInfrastructure
	}
	type writeAck struct{ complete, closed bool }
	written := make(chan writeAck, 1)
	// input is immutable for this call; callers retain a separate private copy.
	go func() {
		n, e := conn.Write(input)
		ack := writeAck{complete: e == nil && n == len(input)}
		if closer, ok := conn.(interface{ CloseWrite() error }); ok && ack.complete {
			ack.closed = closer.CloseWrite() == nil
		}
		written <- ack
	}()
	var stdout, stderr bytes.Buffer
	defer func() {
		observation.Stdout = bytes.Clone(stdout.Bytes())
		observation.Stderr = bytes.Clone(stderr.Bytes())
	}()
	for {
		var header [8]byte
		_, err = io.ReadFull(reader, header[:])
		if err == io.EOF {
			break
		}
		if err != nil {
			if ctx.Err() != nil {
				return observation, ctx.Err()
			}
			return observation, ErrInfrastructure
		}
		if (header[0] != 1 && header[0] != 2) || header[1] != 0 || header[2] != 0 || header[3] != 0 {
			return observation, ErrInfrastructure
		}
		length := uint64(binary.BigEndian.Uint32(header[4:]))
		remaining := cap - stdout.Len() - stderr.Len()
		if length > uint64(remaining) {
			return observation, ErrOutput
		}
		var dest io.Writer = &stdout
		if header[0] == 2 {
			dest = &stderr
		}
		if _, err = io.CopyN(dest, reader, int64(length)); err != nil {
			if ctx.Err() != nil {
				return observation, ctx.Err()
			}
			return observation, ErrInfrastructure
		}
	}
	select {
	case ack := <-written:
		observation.TransportWriteComplete = ack.complete
		observation.StdinHalfClosed = ack.closed
	case <-ctx.Done():
		return observation, ctx.Err()
	}
	if !observation.TransportWriteComplete || !observation.StdinHalfClosed {
		return observation, ErrInfrastructure
	}
	status, statusErr := c.captureAPI(ctx, "GET", "/exec/"+createdID+"/json", nil)
	var id *string
	var running *bool
	var exitCode *int
	if statusErr != nil || json.Unmarshal(status["ID"], &id) != nil || json.Unmarshal(status["Running"], &running) != nil || json.Unmarshal(status["ExitCode"], &exitCode) != nil || id == nil || *id != createdID || running == nil || *running || exitCode == nil || *exitCode < 0 || *exitCode > 255 {
		return observation, ErrInfrastructure
	}
	exit := *exitCode
	observation.ExitCode = &exit
	observation.OutputComplete = true
	return observation, nil
}
