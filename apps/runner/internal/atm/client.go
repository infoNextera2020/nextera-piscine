package atm

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/protocol"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

// Configuration is deliberately absent by default. Every capacity and deadline
// comes from an explicit protected local-trial configuration, never a grade rule.
type Config struct {
	Version          int    `json:"version"`
	Endpoint         string `json:"endpoint"`
	ReceiptDirectory string `json:"receiptDirectory"`
	MaxBodyBytes     int    `json:"maxBodyBytes"`
	MaxCaptureBytes  int    `json:"maxCaptureBytes"`
	MaxCaseCount     int    `json:"maxCaseCount"`
	MaxOutboxFiles   int    `json:"maxOutboxFiles"`
	MaxOutboxBytes   int64  `json:"maxOutboxBytes"`
	TimeoutMS        int    `json:"timeoutMs"`
	ExpiresAt        string `json:"expiresAt"`
}
type Client struct {
	config  Config
	expires time.Time
	http    *http.Client
}
type Prepared struct {
	body                        []byte
	envelope                    Envelope
	endpoint                    string
	path                        string
	reconciledAbsent, attempted bool
}

func protected(path string, dir bool) bool {
	info, err := os.Lstat(path)
	if err != nil {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uint32(os.Geteuid()) && info.Mode().Perm()&0077 == 0 && ((dir && info.IsDir()) || (!dir && info.Mode().IsRegular()))
}
func noSymlinkParents(path string) bool {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return false
	}
	for p := path; p != "/"; p = filepath.Dir(p) {
		i, e := os.Lstat(p)
		if e != nil || !i.IsDir() || i.Mode()&os.ModeSymlink != 0 {
			return false
		}
	}
	return true
}
func (c Config) valid() bool {
	u, err := url.Parse(c.Endpoint)
	expires, e := time.Parse(time.RFC3339Nano, c.ExpiresAt)
	if err != nil {
		return false
	}
	port, portErr := strconv.Atoi(u.Port())
	return portErr == nil && port > 0 && port <= 65535 && u.Scheme == "http" && u.Host == "127.0.0.1:"+strconv.Itoa(port) && u.User == nil && u.Path == "" && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" && u.Opaque == "" && c.Version == 1 && e == nil && time.Now().Before(expires) && c.MaxBodyBytes > 0 && c.MaxCaptureBytes > 0 && c.MaxCaseCount > 0 && c.MaxOutboxFiles > 0 && c.MaxOutboxBytes > 0 && int64(c.MaxBodyBytes) <= c.MaxOutboxBytes && c.TimeoutMS > 0 && protected(c.ReceiptDirectory, true) && noSymlinkParents(c.ReceiptDirectory)
}
func Load(path string) (*Client, error) {
	if path == "" {
		return nil, nil
	}
	if !protected(path, false) {
		return nil, ErrUnavailable
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 65537))
	var config Config
	if err != nil || len(raw) > 65536 || artifact.Strict(raw, &config) != nil || !config.valid() {
		return nil, ErrUnavailable
	}
	expires, _ := time.Parse(time.RFC3339Nano, config.ExpiresAt)
	return &Client{config: config, expires: expires, http: &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: time.Duration(config.TimeoutMS) * time.Millisecond, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) available() bool {
	return c != nil && c.http != nil && time.Now().Before(c.expires) && c.config.valid()
}
func (c *Client) call(ctx context.Context, path string, claim protocol.Claim, body []byte, out any, keys int) error {
	if !c.available() || !uuid.MatchString(claim.Token) || len(body) > c.config.MaxBodyBytes {
		return ErrUnavailable
	}
	end := time.Now().Add(time.Duration(c.config.TimeoutMS) * time.Millisecond)
	if c.expires.Before(end) {
		end = c.expires
	}
	deadline, cancel := context.WithDeadline(ctx, end)
	defer cancel()
	req, err := http.NewRequestWithContext(deadline, "POST", c.config.Endpoint+"/api/internal/atm-evidence/"+path, bytes.NewReader(body))
	if err != nil {
		return ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+claim.Token)
	req.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return ErrUnknown
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, int64(c.config.MaxBodyBytes)+1))
	if err != nil || len(raw) > c.config.MaxBodyBytes || response.StatusCode != 200 || deadline.Err() != nil || !c.available() {
		return ErrUnknown
	}
	var fields map[string]json.RawMessage
	if artifact.Strict(raw, &fields) != nil || len(fields) != keys || artifact.Strict(raw, out) != nil || deadline.Err() != nil || !c.available() {
		return ErrUnknown
	}
	return nil
}
func (c *Client) Resolve(ctx context.Context, claim protocol.Claim, s protocol.Snapshot) (*Context, error) {
	request, err := Request(claim, s)
	if err != nil || !c.available() {
		return nil, ErrUnavailable
	}
	body, _ := json.Marshal(request)
	var binding Context
	if c.call(ctx, "resolve", claim, body, &binding, 23) != nil || !binding.Bound(s) || binding.CaseCount > c.config.MaxCaseCount {
		return nil, ErrUnavailable
	}
	return &binding, nil
}

func validateCaptures(context Context, captures []Capture, maxBytes int) bool {
	if len(captures) > context.CaseCount {
		return false
	}
	total := 0
	private := false
	for i, entry := range captures {
		if entry.CaseIndex != i || !hash.MatchString(entry.InputSHA256) {
			return false
		}
		if entry.CaseFile == "cases/private.json" {
			private = true
		} else if entry.CaseFile != "cases/public.json" || private {
			return false
		}
		var decoded [3][]byte
		for n, text := range []string{entry.StdinBase64, entry.StdoutBase64, entry.StderrBase64} {
			raw, err := base64.StdEncoding.Strict().DecodeString(text)
			if err != nil || base64.StdEncoding.EncodeToString(raw) != text {
				return false
			}
			total += len(raw)
			if total > maxBytes {
				return false
			}
			decoded[n] = raw
		}
		if SHA(decoded[0]) != entry.InputSHA256 {
			return false
		}
		if entry.Termination != "exited" && entry.Termination != "timed_out" && entry.Termination != "unknown" {
			return false
		}
		if (entry.Termination == "exited") != (entry.ExitCode != nil) || entry.ExitCode != nil && (*entry.ExitCode < 0 || *entry.ExitCode > 255) || entry.OutputComplete && entry.Termination != "exited" || entry.StdinHalfClosed && !entry.TransportWriteComplete {
			return false
		}
		switch entry.Assessment {
		case "observations_match", "projection_mismatch":
			if !entry.TransportWriteComplete || !entry.StdinHalfClosed || !entry.OutputComplete || entry.ExitCode == nil || *entry.ExitCode != 0 {
				return false
			}
		case "execution_not_clean", "incomplete_observation", "capture_unavailable":
		default:
			return false
		}
	}
	return true
}
func newOperation() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", ErrUnavailable
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	s := hex.EncodeToString(b[:])
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:], nil
}

// Persist a token-free immutable envelope BEFORE any native retention request.
// The endpoint is protected outer metadata; evidence digests are unchanged.
type stored struct {
	Version  int      `json:"version"`
	Endpoint string   `json:"endpoint"`
	Envelope Envelope `json:"envelope"`
}

func (c *Client) Prepare(evidence Evidence) (*Prepared, error) {
	if !c.available() || !evidence.StopVerified || evidence.Context.CaseCount > c.config.MaxCaseCount || !validateCaptures(evidence.Context, evidence.Captures, c.config.MaxCaptureBytes) {
		return nil, ErrUnavailable
	}
	copy := evidence.Clone()
	contextDigest, err := copy.Context.Digest()
	if err != nil || contextDigest != copy.Context.ContextDigest {
		return nil, ErrUnavailable
	}
	op, err := newOperation()
	if err != nil {
		return nil, err
	}
	digest, err := CaptureDigest(copy.Context, copy.Captures)
	if err != nil {
		return nil, err
	}
	envelope := Envelope{1, op, copy.Context, digest, copy.Captures}
	body, _ := json.Marshal(envelope)
	outer, _ := json.Marshal(stored{1, c.config.Endpoint, envelope})
	if len(body) > c.config.MaxBodyBytes || int64(len(outer)) > c.config.MaxOutboxBytes {
		return nil, ErrUnavailable
	}
	lock, err := os.Open(c.config.ReceiptDirectory)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer lock.Close()
	if syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return nil, ErrUnavailable
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	entries, err := os.ReadDir(c.config.ReceiptDirectory)
	if err != nil {
		return nil, ErrUnavailable
	}
	var size int64
	if len(entries) >= c.config.MaxOutboxFiles {
		return nil, ErrUnavailable
	}
	for _, entry := range entries {
		path := filepath.Join(c.config.ReceiptDirectory, entry.Name())
		info, e := os.Lstat(path)
		if e != nil || !protected(path, false) {
			return nil, ErrUnavailable
		}
		size += info.Size()
	}
	if size+int64(len(outer)) > c.config.MaxOutboxBytes {
		return nil, ErrUnavailable
	}
	path := filepath.Join(c.config.ReceiptDirectory, op+".json")
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, ErrUnavailable
	}
	n, writeErr := file.Write(outer)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || n != len(outer) || syncErr != nil || closeErr != nil {
		return nil, ErrUnavailable
	}
	dir, err := os.Open(c.config.ReceiptDirectory)
	if err != nil {
		return nil, ErrUnavailable
	}
	syncErr = dir.Sync()
	_ = dir.Close()
	if syncErr != nil {
		return nil, ErrUnavailable
	}
	p := &Prepared{body: bytes.Clone(body), envelope: envelope, endpoint: c.config.Endpoint, path: path}
	if !c.same(p) {
		return nil, ErrUnavailable
	}
	return p, nil
}
func (c *Client) same(p *Prepared) bool {
	if !c.available() || p == nil || p.endpoint != c.config.Endpoint || !uuid.MatchString(p.envelope.OperationID) || p.path != filepath.Join(c.config.ReceiptDirectory, p.envelope.OperationID+".json") || !protected(p.path, false) {
		return false
	}
	file, err := os.OpenFile(p.path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return false
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, c.config.MaxOutboxBytes+1))
	expected, _ := json.Marshal(stored{1, p.endpoint, p.envelope})
	body, _ := json.Marshal(p.envelope)
	return err == nil && bytes.Equal(raw, expected) && bytes.Equal(body, p.body)
}
func claimMatches(claim protocol.Claim, binding Context) bool {
	return claim.Job == binding.JobID && claim.Attempt == binding.JudgeAttemptID && claim.Worker == binding.WorkerID && claim.Generation > 0 && binding.Generation == strconv.FormatInt(claim.Generation, 10) && uuid.MatchString(claim.Token) && claim.Digest == binding.EvaluationSnapshotDigest
}
func exactAck(ack Ack, p *Prepared) bool {
	return ack.Version == 1 && ack.OperationID == p.envelope.OperationID && ack.ContextDigest == p.envelope.Context.ContextDigest && ack.CaptureDigest == p.envelope.CaptureDigest
}
func (c *Client) Retain(ctx context.Context, claim protocol.Claim, p *Prepared) error {
	if !c.same(p) || !claimMatches(claim, p.envelope.Context) || p.attempted {
		return ErrUnavailable
	}
	p.attempted = true
	var ack Ack
	if c.call(ctx, "retain", claim, p.body, &ack, 5) != nil || !exactAck(ack, p) || ack.State != "retained" || ctx.Err() != nil || !c.available() {
		return ErrUnknown
	}
	return nil
}
func (c *Client) Reconcile(ctx context.Context, claim protocol.Claim, p *Prepared) (bool, error) {
	if !c.same(p) || !claimMatches(claim, p.envelope.Context) {
		return false, ErrUnavailable
	}
	body, _ := json.Marshal(struct {
		Version       int     `json:"version"`
		OperationID   string  `json:"operationId"`
		Context       Context `json:"context"`
		CaptureDigest string  `json:"captureDigest"`
	}{1, p.envelope.OperationID, p.envelope.Context, p.envelope.CaptureDigest})
	var ack Ack
	if c.call(ctx, "reconcile", claim, body, &ack, 5) != nil || !exactAck(ack, p) || (ack.State != "retained" && ack.State != "not_retained") {
		return false, ErrUnknown
	}
	p.reconciledAbsent = ack.State == "not_retained"
	return ack.State == "retained", nil
}

// Retry is deliberately explicit and only follows an acknowledged absent read.
// The server's same-operation serialization handles a late original commit.
func (c *Client) Retry(ctx context.Context, claim protocol.Claim, p *Prepared) error {
	if p == nil || !p.reconciledAbsent {
		return ErrUnavailable
	}
	p.reconciledAbsent = false
	p.attempted = false
	return c.Retain(ctx, claim, p)
}

// Open supports operator-controlled recovery; no new context/op is generated.
func (c *Client) Open(operationID string) (*Prepared, error) {
	if !c.available() || !uuid.MatchString(operationID) {
		return nil, ErrUnavailable
	}
	path := filepath.Join(c.config.ReceiptDirectory, operationID+".json")
	if !protected(path, false) {
		return nil, ErrUnavailable
	}
	file, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, c.config.MaxOutboxBytes+1))
	var outer stored
	if err != nil || int64(len(raw)) > c.config.MaxOutboxBytes || artifact.Strict(raw, &outer) != nil || outer.Version != 1 || outer.Envelope.OperationID != operationID || outer.Endpoint != c.config.Endpoint || !validateCaptures(outer.Envelope.Context, outer.Envelope.Captures, c.config.MaxCaptureBytes) {
		return nil, ErrUnavailable
	}
	digest, _ := CaptureDigest(outer.Envelope.Context, outer.Envelope.Captures)
	if digest != outer.Envelope.CaptureDigest {
		return nil, ErrUnavailable
	}
	body, _ := json.Marshal(outer.Envelope)
	p := &Prepared{body: body, envelope: outer.Envelope, endpoint: outer.Endpoint, path: path, attempted: true}
	if !c.same(p) {
		return nil, ErrUnavailable
	}
	return p, nil
}

// One original publication budget covers Retain and at most one reconciliation
// read. No automatic write retry or new operation follows uncertainty.
func (c *Client) Acknowledge(ctx context.Context, claim protocol.Claim, evidence Evidence) error {
	if !c.available() {
		return ErrUnavailable
	}
	end := time.Now().Add(time.Duration(c.config.TimeoutMS) * time.Millisecond)
	if c.expires.Before(end) {
		end = c.expires
	}
	phase, cancel := context.WithDeadline(ctx, end)
	defer cancel()
	prepared, err := c.Prepare(evidence)
	if err != nil {
		return err
	}
	err = c.Retain(phase, claim, prepared)
	if err == nil {
		return nil
	}
	if err != ErrUnknown {
		return err
	}
	retained, readErr := c.Reconcile(phase, claim, prepared)
	if readErr == nil && retained && phase.Err() == nil && c.available() {
		return nil
	}
	return ErrUnknown
}
