// Package executor keeps the private oracle in the trusted process. The public
// function transport adapter contains no assessment logic, cases, or expected answers.
package executor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/feedback"
	"nextera.local/runner/internal/protocol"
	"nextera.local/runner/internal/sandbox"
	"os"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Executor struct {
	Engine                *sandbox.Engine
	StorageURL, TokenFile string
}
type Result struct {
	Verdict, Code string
	Metrics       map[string]int64
}

func infrastructure(code string) Result {
	return Result{Verdict: "system_error", Code: code, Metrics: map[string]int64{}}
}

type testCase struct {
	Input    json.RawMessage `json:"input"`
	Expected *string         `json:"expected"`
}

func cases(files map[string][]byte, id string) ([]json.RawMessage, []string, error) {
	c, err := artifact.ContractFor(id, nil)
	if err != nil {
		return nil, nil, err
	}
	return casesFor(files, c)
}
func casesFor(files map[string][]byte, contract artifact.ExecutionContract) ([]json.RawMessage, []string, error) {
	var inputs []json.RawMessage
	var expected []string
	for _, name := range []string{"cases/public.json", "cases/private.json"} {
		var rows []testCase
		if !utf8.Valid(files[name]) || artifact.Strict(files[name], &rows) != nil || len(rows) == 0 || len(rows) > 10000 {
			return nil, nil, artifact.ErrInvalid
		}
		for _, r := range rows {
			if r.Expected == nil || len(r.Input) == 0 {
				return nil, nil, artifact.ErrInvalid
			}
			if contract.Input == "string" {
				var v string
				if r.Input[0] != '"' || json.Unmarshal(r.Input, &v) != nil {
					return nil, nil, artifact.ErrInvalid
				}
			} else {
				var v int64
				if string(r.Input) == "null" || json.Unmarshal(r.Input, &v) != nil {
					return nil, nil, artifact.ErrInvalid
				}
			}
			inputs = append(inputs, r.Input)
			expected = append(expected, *r.Expected)
		}
	}
	return inputs, expected, nil
}

// This is a public stdin/stdout adapter for the public challenge signatures.
// The hidden pack's bridge/source is deliberately never copied into either container.
func adapter(id string) []byte {
	c, err := artifact.ContractFor(id, nil)
	if err != nil {
		return nil
	}
	return adapterFor(c)
}
func adapterFor(c artifact.ExecutionContract) []byte {
	typ := c.Input
	// Existing EvenOrOdd uses Go int; its accepted platform is linux/amd64.
	if c.Function == "EvenOrOdd" && c.Item == "even-or-odd" {
		typ = "int"
	}
	return []byte(`package main
import("encoding/json";"os")
func main(){var inputs []` + typ + `;if json.NewDecoder(os.Stdin).Decode(&inputs)!=nil{os.Exit(2)};outputs:=make([]string,0,len(inputs));for _,v:=range inputs{outputs=append(outputs,` + c.Function + `(v))};if json.NewEncoder(os.Stdout).Encode(outputs)!=nil{os.Exit(2)}}
`)
}
func (e Executor) source(ctx context.Context, s protocol.Source) ([]byte, error) {
	info, err := os.Stat(e.TokenFile)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 16384 {
		return nil, errors.New("STORAGE_FAILURE")
	}
	token, err := os.ReadFile(e.TokenFile)
	if err != nil {
		return nil, errors.New("STORAGE_FAILURE")
	}
	base, err := url.Parse(e.StorageURL)
	if err != nil || base.RawQuery != "" || base.Fragment != "" || base.User != nil {
		return nil, errors.New("STORAGE_FAILURE")
	}
	if base.Scheme != "https" && !(base.Scheme == "http" && (base.Hostname() == "127.0.0.1" || base.Hostname() == "localhost")) {
		return nil, errors.New("STORAGE_FAILURE")
	}
	base.Path = "/storage/v1/object/authenticated/" + s.Bucket + "/" + s.Key
	req, err := http.NewRequestWithContext(ctx, "GET", base.String(), nil)
	if err != nil {
		return nil, errors.New("STORAGE_FAILURE")
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	req.Header.Set("apikey", os.Getenv("JUDGE_STORAGE_PUBLISHABLE_KEY"))
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return nil, errors.New("STORAGE_FAILURE")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, errors.New("STORAGE_FAILURE")
	}
	bytes, err := io.ReadAll(io.LimitReader(response.Body, 262145))
	if err != nil {
		return nil, errors.New("STORAGE_FAILURE")
	}
	digest := sha256.Sum256(bytes)
	if int64(len(bytes)) != s.Size || hex.EncodeToString(digest[:]) != s.Digest {
		return nil, errors.New("ARTIFACT_MISMATCH")
	}
	return bytes, nil
}
func (e Executor) Evaluate(ctx context.Context, s protocol.Snapshot, layout string) Result {
	if _, err := artifact.ContractFor(s.PackID, s.Contract); err != nil {
		return infrastructure("INCOMPATIBLE_ENVIRONMENT")
	}
	source, err := e.source(ctx, s.Source)
	if err != nil {
		return infrastructure(err.Error())
	}
	files, err := artifact.ReadVerified(layout, s.PackID, s.Entry)
	if err != nil {
		return infrastructure("ARTIFACT_MISMATCH")
	}
	inputs, expected, err := casesFor(files, func() artifact.ExecutionContract { c, _ := artifact.ContractFor(s.PackID, s.Contract); return c }())
	if err != nil {
		return infrastructure("INCOMPATIBLE_ENVIRONMENT")
	}
	if e.Engine.VerifyImage(ctx, s.Sandbox) != nil {
		return infrastructure("ARTIFACT_UNAVAILABLE")
	}
	metrics := map[string]int64{}
	program, verdict, err := e.compile(ctx, s, source, metrics)
	if err != nil {
		return infrastructure("CONTAINER_FAILURE")
	}
	if verdict != "" {
		return Result{Verdict: verdict, Metrics: metrics}
	}
	verdict, err = e.execute(ctx, s, program, inputs, expected, metrics)
	if err != nil {
		return infrastructure("CONTAINER_FAILURE")
	}
	return Result{Verdict: feedback.Project(verdict).Verdict, Metrics: metrics}
}
func (e Executor) compile(ctx context.Context, s protocol.Snapshot, source []byte, metrics map[string]int64) ([]byte, string, error) {
	c, err := e.Engine.Create(ctx, s.Sandbox, true)
	if err != nil {
		return nil, "", err
	}
	defer c.Close()
	if c.Import(ctx, map[string][]byte{"solution.go": source, "transport.go": adapterFor(func() artifact.ExecutionContract { c, _ := artifact.ContractFor(s.PackID, s.Contract); return c }())}) != nil {
		return nil, "", sandbox.ErrInfrastructure
	}
	phase, cancel := context.WithTimeout(ctx, time.Duration(s.Resources.Compilation.Timeout)*time.Millisecond)
	started := time.Now()
	_, _, exit, err := c.Exec(phase, []string{"/bin/sh", "-c", "cp -as /opt/go-cache /workspace/cache && exec go build -trimpath -buildvcs=false -p=1 -ldflags=-buildid= -o /workspace/program /workspace/solution.go /workspace/transport.go"}, []string{"GOMEMLIMIT=384MiB"}, nil, 65536)
	metrics["compilation_ms"] = time.Since(started).Milliseconds()
	cancel()
	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, sandbox.ErrOutput) || (err == nil && exit != 0) {
		return nil, "compile_error", nil
	}
	if err != nil {
		return nil, "", err
	}
	transfer, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	raw, _, exit, err := c.Exec(transfer, []string{"/bin/tar", "--format=ustar", "-cf", "-", "-C", "/workspace", "program"}, nil, nil, 8<<20)
	if err != nil || exit != 0 {
		return nil, "", sandbox.ErrInfrastructure
	}
	program, err := sandbox.Compiled(raw)
	if err != nil {
		return nil, "", err
	}
	metrics["compiled_bytes"] = int64(len(program))
	return program, "", nil
}
func (e Executor) execute(ctx context.Context, s protocol.Snapshot, program []byte, inputs []json.RawMessage, expected []string, metrics map[string]int64) (string, error) {
	c, err := e.Engine.Create(ctx, s.Sandbox, false)
	if err != nil {
		return "", err
	}
	defer c.Close()
	if c.Import(ctx, map[string][]byte{"program": program}) != nil {
		return "", sandbox.ErrInfrastructure
	}
	if _, _, exit, err := c.Exec(ctx, []string{"/bin/chmod", "500", "/workspace/program"}, nil, nil, 65536); err != nil || exit != 0 {
		return "", sandbox.ErrInfrastructure
	}
	input, _ := json.Marshal(inputs)
	phase, cancel := context.WithTimeout(ctx, time.Duration(s.Resources.Execution.Timeout)*time.Millisecond)
	started := time.Now()
	out, stderr, exit, err := c.Exec(phase, []string{"/workspace/program"}, nil, input, 65536)
	metrics["execution_ms"] = time.Since(started).Milliseconds()
	cancel()
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout", nil
	}
	if errors.Is(err, sandbox.ErrOutput) {
		return "runtime_error", nil
	}
	if err != nil {
		return "", err
	}
	if exit != 0 || len(stderr) != 0 {
		return "runtime_error", nil
	}
	// Kernel observations override an apparently successful process that handled resource exhaustion.
	for _, pair := range [][2]string{{"pids", "max"}, {"memory", "oom_kill"}} {
		raw, _, code, err := c.Exec(ctx, []string{"/bin/cat", "/sys/fs/cgroup/" + pair[0] + ".events"}, nil, nil, 65536)
		if err != nil || code != 0 {
			return "runtime_error", nil
		}
		for _, line := range strings.Split(string(raw), "\n") {
			fields := strings.Fields(line)
			if len(fields) == 2 && fields[0] == pair[1] && fields[1] != "0" {
				return "runtime_error", nil
			}
		}
	}
	raw, _, code, err := c.Exec(ctx, []string{"/usr/bin/stat", "-f", "-c", "%a %d", "/workspace", "/tmp", "/dev/shm"}, nil, nil, 65536)
	if err != nil || code != 0 {
		return "runtime_error", nil
	}
	for _, field := range strings.Fields(string(raw)) {
		value, err := strconv.ParseInt(field, 10, 64)
		if err != nil {
			return "", sandbox.ErrInfrastructure
		}
		if value == 0 {
			return "runtime_error", nil
		}
	}
	var actual []string
	if !utf8.Valid(out) || json.Unmarshal(out, &actual) != nil || !reflect.DeepEqual(actual, expected) {
		return "failed", nil
	}
	return "passed", nil
}
