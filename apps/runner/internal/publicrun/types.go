// Package publicrun executes authored public examples only. It never loads a grading pack.
package publicrun

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrInvalid = errors.New("VISIBLE_RUN_UNAVAILABLE")

const Ceiling = 262144
const MaxRequestBytes = 1 << 20

func ValidDigest(s string) bool { return digest.MatchString(s) }

const Purpose = "nextera-visible-run-v1"

var uuid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var digest = regexp.MustCompile(`^[0-9a-f]{64}$`)
var image = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var key = regexp.MustCompile(`^[a-z0-9-]{1,100}$`)
var file = regexp.MustCompile(`^[A-Za-z0-9_]+[.]go$`)
var symbol = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var integer = regexp.MustCompile(`^(0|-?[1-9][0-9]*)$`)

const keywords = " break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var _ "

type Scope struct {
	LearnerID        string `json:"learnerId"`
	CohortID         string `json:"cohortId"`
	AttemptID        string `json:"attemptId"`
	TaskKey          string `json:"taskKey"`
	DefinitionDigest string `json:"definitionDigest"`
}
type Intent struct {
	Scope          Scope  `json:"scope"`
	RequestID      string `json:"requestId"`
	Filename       string `json:"filename"`
	Source         string `json:"source"`
	SourceDigest   string `json:"sourceDigest"`
	ByteLength     int    `json:"byteLength"`
	ManifestDigest string `json:"manifestDigest"`
	PolicyDigest   string `json:"policyDigest"`
	Deadline       string `json:"deadline"`
}
type Harness struct {
	Kind         string `json:"kind"`
	PackageName  string `json:"packageName"`
	FunctionName string `json:"functionName"`
	Argument     string `json:"argument"`
	Returns      string `json:"returns"`
}
type Example struct {
	Key            string `json:"key"`
	Input          string `json:"input"`
	ExpectedOutput string `json:"expectedOutput"`
}
type Manifest struct {
	Version          int       `json:"version"`
	Visibility       string    `json:"visibility"`
	Language         string    `json:"language"`
	TaskKey          string    `json:"taskKey"`
	DefinitionDigest string    `json:"definitionDigest"`
	Filename         string    `json:"filename"`
	Harness          Harness   `json:"harness"`
	Examples         []Example `json:"examples"`
}
type Limits struct {
	TimeoutMS         int64 `json:"timeoutMs"`
	MemoryMB          int64 `json:"memoryMb"`
	OutputBytes       int64 `json:"outputBytes"`
	SourceBytes       int64 `json:"sourceBytes"`
	RequestsPerWindow int64 `json:"requestsPerWindow"`
	WindowMS          int64 `json:"windowMs"`
	Concurrency       int64 `json:"concurrency"`
}
type Budgets struct {
	CompilationMS int64 `json:"compilationMs"`
	StartupMS     int64 `json:"startupMs"`
	LeaseMS       int64 `json:"leaseMs"`
}
type Storage struct {
	MaxRunsPerAttempt        int64 `json:"maxRunsPerAttempt"`
	MaxSourceBytesPerAttempt int64 `json:"maxSourceBytesPerAttempt"`
	ReadAfterDeadlineSeconds int64 `json:"readAfterDeadlineSeconds"`
}
type Isolation struct {
	ImageDigest         string `json:"imageDigest"`
	Network             string `json:"network"`
	HostAccess          string `json:"hostAccess"`
	Filesystem          string `json:"filesystem"`
	ProcessUser         string `json:"processUser"`
	ResourceEnforcement string `json:"resourceEnforcement"`
}

// Field order intentionally matches the TypeScript canonical policy serializer.
type Policy struct {
	Version                int       `json:"version"`
	Key                    string    `json:"key"`
	Enabled                bool      `json:"enabled"`
	Visibility             string    `json:"visibility"`
	Graded                 bool      `json:"graded"`
	ConsumesGradedAttempts bool      `json:"consumesGradedAttempts"`
	Limits                 Limits    `json:"limits"`
	MaxExamples            int64     `json:"maxExamples"`
	Budgets                Budgets   `json:"budgets"`
	Storage                Storage   `json:"storage"`
	Isolation              Isolation `json:"isolation"`
}
type Work struct {
	RunID    string   `json:"runId"`
	Intent   Intent   `json:"intent"`
	Manifest Manifest `json:"manifest"`
	Policy   Policy   `json:"policy"`
}
type Request struct {
	Version     int    `json:"version"`
	Generation  int64  `json:"generation"`
	ExecutionID string `json:"executionId"`
	Work        Work   `json:"work"`
}
type Outcome struct {
	RunID        string  `json:"runId"`
	IntentDigest string  `json:"intentDigest"`
	Generation   int64   `json:"generation"`
	ExecutionID  string  `json:"executionId"`
	State        string  `json:"state"`
	Output       string  `json:"output"`
	StoppedProof *string `json:"stoppedProof"`
}

func sha(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }

// jsJSON preserves JSON.stringify's string escaping (including raw U+2028/U+2029).
// It is limited to typed data, never an arbitrary object with executable properties.
func jsJSON(value any) []byte {
	var b strings.Builder
	var write func(reflect.Value)
	quote := func(s string) {
		b.WriteByte('"')
		for _, r := range s {
			switch r {
			case '"':
				b.WriteString(`\"`)
			case '\\':
				b.WriteString(`\\`)
			case '\b':
				b.WriteString(`\b`)
			case '\f':
				b.WriteString(`\f`)
			case '\n':
				b.WriteString(`\n`)
			case '\r':
				b.WriteString(`\r`)
			case '\t':
				b.WriteString(`\t`)
			default:
				if r < 32 {
					b.WriteString(`\u00`)
					b.WriteString(hex.EncodeToString([]byte{byte(r)}))
				} else {
					b.WriteRune(r)
				}
			}
		}
		b.WriteByte('"')
	}
	write = func(v reflect.Value) {
		if v.Kind() == reflect.Interface {
			write(v.Elem())
			return
		}
		switch v.Kind() {
		case reflect.String:
			quote(v.String())
		case reflect.Bool:
			b.WriteString(strconv.FormatBool(v.Bool()))
		case reflect.Int, reflect.Int64, reflect.Int32:
			b.WriteString(strconv.FormatInt(v.Int(), 10))
		case reflect.Slice, reflect.Array:
			b.WriteByte('[')
			for i := 0; i < v.Len(); i++ {
				if i > 0 {
					b.WriteByte(',')
				}
				write(v.Index(i))
			}
			b.WriteByte(']')
		case reflect.Struct:
			b.WriteByte('{')
			for i := 0; i < v.NumField(); i++ {
				if i > 0 {
					b.WriteByte(',')
				}
				quote(v.Type().Field(i).Tag.Get("json"))
				b.WriteByte(':')
				write(v.Field(i))
			}
			b.WriteByte('}')
		default:
			panic("unsupported trusted canonical type")
		}
	}
	write(reflect.ValueOf(value))
	return []byte(b.String())
}
func ManifestDigest(m Manifest) string {
	return sha(append([]byte("nextera-visible-examples\x00v1\x00"), jsJSON(m)...))
}
func PolicyDigest(p Policy) string {
	return sha(append([]byte("nextera-visible-run-policy\x00v1\x00"), jsJSON(p)...))
}
func IntentDigest(i Intent) string {
	s := i.Scope
	return sha(append([]byte("nextera-visible-run-intent\x00v1\x00"), jsJSON([]any{s.LearnerID, s.CohortID, s.AttemptID, s.TaskKey, s.DefinitionDigest, i.RequestID, i.Filename, i.SourceDigest, i.ByteLength, i.ManifestDigest, i.PolicyDigest, i.Deadline})...))
}
func positive(n int64) bool              { return n > 0 && n <= 2147483647 }
func bytesOK(s string, limit int64) bool { return utf8.ValidString(s) && int64(len(s)) <= limit }

func Validate(r Request, pinnedImage string) error {
	w := r.Work
	i := w.Intent
	m := w.Manifest
	p := w.Policy
	s := i.Scope
	if r.Version != 1 || r.Generation < 1 || r.Generation > 9007199254740991 || !uuid.MatchString(r.ExecutionID) || !uuid.MatchString(w.RunID) || !uuid.MatchString(i.RequestID) || !uuid.MatchString(s.LearnerID) || !uuid.MatchString(s.CohortID) || !uuid.MatchString(s.AttemptID) || !key.MatchString(s.TaskKey) || !digest.MatchString(s.DefinitionDigest) {
		return ErrInvalid
	}
	if m.Version != 1 || m.Visibility != "visible_examples" || m.Language != "go" || m.TaskKey != s.TaskKey || m.DefinitionDigest != s.DefinitionDigest || m.Filename != i.Filename || len(m.Filename) > 100 || !file.MatchString(m.Filename) || m.Harness.Kind != "go_function_v1" || m.Harness.PackageName != "main" || len(m.Harness.FunctionName) > 100 || !symbol.MatchString(m.Harness.FunctionName) || strings.Contains(keywords, " "+m.Harness.FunctionName+" ") || (m.Harness.Argument != "string" && m.Harness.Argument != "int64") || m.Harness.Returns != "string" {
		return ErrInvalid
	}
	if p.Version != 1 || !key.MatchString(p.Key) || !p.Enabled || p.Visibility != "visible_examples" || p.Graded || p.ConsumesGradedAttempts || !positive(p.MaxExamples) || p.MaxExamples > Ceiling || len(m.Examples) < 1 || int64(len(m.Examples)) > p.MaxExamples {
		return ErrInvalid
	}
	for _, n := range []int64{p.Limits.TimeoutMS, p.Limits.MemoryMB, p.Limits.OutputBytes, p.Limits.SourceBytes, p.Limits.RequestsPerWindow, p.Limits.WindowMS, p.Limits.Concurrency, p.Budgets.CompilationMS, p.Budgets.StartupMS, p.Budgets.LeaseMS, p.Storage.MaxRunsPerAttempt} {
		if !positive(n) {
			return ErrInvalid
		}
	}
	if p.Limits.SourceBytes > Ceiling || p.Limits.OutputBytes > Ceiling || p.Storage.MaxSourceBytesPerAttempt < p.Limits.SourceBytes || p.Storage.MaxSourceBytesPerAttempt > 9007199254740991 || p.Storage.ReadAfterDeadlineSeconds < 0 || p.Storage.ReadAfterDeadlineSeconds > 2147483647 {
		return ErrInvalid
	}
	// Supported engine profile, NOT a selected/enabled Run policy. No defaults.
	if p.Limits.TimeoutMS != 2000 || p.Limits.MemoryMB != 64 || p.Limits.OutputBytes != 65536 || p.Budgets.CompilationMS != 20000 || p.Budgets.StartupMS+p.Budgets.CompilationMS >= 45000 {
		return ErrInvalid
	}
	if !image.MatchString(pinnedImage) || p.Isolation.ImageDigest != pinnedImage || p.Isolation.Network != "none" || p.Isolation.HostAccess != "none" || p.Isolation.Filesystem != "disposable" || p.Isolation.ProcessUser != "unprivileged" || p.Isolation.ResourceEnforcement != "external" {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, e := range m.Examples {
		if !key.MatchString(e.Key) || seen[e.Key] || !bytesOK(e.Input, Ceiling) || !bytesOK(e.ExpectedOutput, Ceiling) {
			return ErrInvalid
		}
		seen[e.Key] = true
		if m.Harness.Argument == "int64" {
			if !integer.MatchString(e.Input) {
				return ErrInvalid
			}
			if _, err := strconv.ParseInt(e.Input, 10, 64); err != nil {
				return ErrInvalid
			}
		}
	}
	if len(jsJSON(m)) > Ceiling || len(jsJSON(p)) > Ceiling || len(i.Source) == 0 || !bytesOK(i.Source, p.Limits.SourceBytes) || i.ByteLength != len(i.Source) || i.SourceDigest != sha([]byte(i.Source)) || i.ManifestDigest != ManifestDigest(m) || i.PolicyDigest != PolicyDigest(p) {
		return ErrInvalid
	}
	if _, err := time.Parse(time.RFC3339Nano, i.Deadline); err != nil {
		return ErrInvalid
	}
	return nil
}

// Reject duplicate/unknown/missing keys, trailing JSON and unpaired UTF-16 escapes.
func ParseRequest(data []byte) (Request, error) {
	var r Request
	if len(data) > MaxRequestBytes || !utf8.Valid(data) || !validEscapes(data) {
		return r, ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(data))
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 32 {
			return ErrInvalid
		}
		t, e := d.Token()
		if e != nil {
			return ErrInvalid
		}
		if x, ok := t.(json.Delim); ok {
			switch x {
			case '{':
				seen := map[string]bool{}
				for d.More() {
					k, e := d.Token()
					name, ok := k.(string)
					if e != nil || !ok || seen[name] {
						return ErrInvalid
					}
					seen[name] = true
					if walk(depth+1) != nil {
						return ErrInvalid
					}
				}
			case '[':
				for d.More() {
					if walk(depth+1) != nil {
						return ErrInvalid
					}
				}
			default:
				return ErrInvalid
			}
			if _, e = d.Token(); e != nil {
				return ErrInvalid
			}
		}
		return nil
	}
	if walk(0) != nil {
		return r, ErrInvalid
	}
	if _, err := d.Token(); err != io.EOF {
		return r, ErrInvalid
	}
	if required(data, reflect.TypeOf(r)) != nil {
		return r, ErrInvalid
	}
	d = json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&r) != nil {
		return r, ErrInvalid
	}
	return r, nil
}
func required(raw json.RawMessage, t reflect.Type) error {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return ErrInvalid
	}
	switch t.Kind() {
	case reflect.Struct:
		var obj map[string]json.RawMessage
		if json.Unmarshal(raw, &obj) != nil || len(obj) != t.NumField() {
			return ErrInvalid
		}
		for j := 0; j < t.NumField(); j++ {
			f := t.Field(j)
			v, ok := obj[f.Tag.Get("json")]
			if !ok || required(v, f.Type) != nil {
				return ErrInvalid
			}
		}
	case reflect.Slice:
		var rows []json.RawMessage
		if json.Unmarshal(raw, &rows) != nil {
			return ErrInvalid
		}
		for _, v := range rows {
			if required(v, t.Elem()) != nil {
				return ErrInvalid
			}
		}
	}
	return nil
}
func validEscapes(data []byte) bool {
	for n := 0; n < len(data); n++ {
		if data[n] != '"' {
			continue
		}
		n++
		for n < len(data) && data[n] != '"' {
			if data[n] == '\\' {
				n++
				if n >= len(data) {
					return false
				}
				if data[n] == 'u' {
					if n+4 >= len(data) {
						return false
					}
					v, e := strconv.ParseUint(string(data[n+1:n+5]), 16, 16)
					if e != nil {
						return false
					}
					n += 4
					if v >= 0xD800 && v <= 0xDBFF {
						if n+6 >= len(data) || data[n+1] != '\\' || data[n+2] != 'u' {
							return false
						}
						lo, e := strconv.ParseUint(string(data[n+3:n+7]), 16, 16)
						if e != nil || lo < 0xDC00 || lo > 0xDFFF {
							return false
						}
						n += 6
					} else if v >= 0xDC00 && v <= 0xDFFF {
						return false
					}
				}
			}
			n++
		}
	}
	return true
}
