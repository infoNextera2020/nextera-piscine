// Package protocol defines the frozen wire identity, without loading learner code.
package protocol

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"nextera.local/runner/internal/artifact"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var ErrIdentity = errors.New("INCOMPATIBLE_ENVIRONMENT")
var hash = regexp.MustCompile(`^[0-9a-f]{64}$`)
var uuid = regexp.MustCompile(`^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)
var commit = regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`)

type Source struct {
	ID       string `json:"id"`
	Bucket   string `json:"bucket"`
	Key      string `json:"key"`
	Filename string `json:"filename"`
	Size     int64  `json:"size_bytes"`
	Digest   string `json:"sha256"`
}
type Snapshot struct {
	artifact.Entry
	PackID        string `json:"test_pack_id"`
	CurriculumID  string `json:"curriculum_version_id"`
	CurriculumKey string `json:"curriculum_key"`
	Version       string `json:"curriculum_version"`
	Commit        string `json:"git_commit_sha"`
	Content       string `json:"content_digest"`
	Node          string `json:"node_key"`
	Subject       string `json:"subject_digest"`
	Configuration string `json:"configuration_digest"`
	SpecDigest    string `json:"evaluation_spec_digest"`
	Learner       string `json:"learner_id"`
	Cohort        string `json:"cohort_id"`
	Submission    string `json:"submission_id"`
	Ordinal       int64  `json:"learner_attempt_ordinal"`
	Accepted      string `json:"accepted_at"`
	Source        Source `json:"artifact"`
	TestOnly      bool   `json:"test_only,omitempty"`
}
type Claim struct {
	Job        string          `json:"job_id"`
	Attempt    string          `json:"attempt_id"`
	Worker     string          `json:"worker_id"`
	Token      string          `json:"token"`
	Generation int64           `json:"generation"`
	Snapshot   json.RawMessage `json:"evaluation_snapshot"`
	Digest     string          `json:"evaluation_digest"`
	Expiry     string          `json:"lease_expires_at"`
}

// The v1 format uses JSON integers and ASCII identity fields. Encoder sorting matches SQL's C ordering.
func Digest(data []byte, domain string) (string, error) {
	var v any
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	if d.Decode(&v) != nil {
		return "", ErrIdentity
	}
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if e.Encode(v) != nil {
		return "", ErrIdentity
	}
	sum := sha256.Sum256(append([]byte(domain+"\x00v1\x00"), bytes.TrimSuffix(b.Bytes(), []byte("\n"))...))
	return hex.EncodeToString(sum[:]), nil
}
func Verify(c Claim, catalog artifact.Catalog, runner, layouts string, local bool) (Snapshot, string, error) {
	var s Snapshot
	digest, err := Digest(c.Snapshot, "nextera-evaluation-snapshot")
	if err != nil || digest != c.Digest || artifact.Strict(c.Snapshot, &s) != nil {
		return s, "", ErrIdentity
	}
	entry, ok := catalog.Packs[s.PackID]
	_, acceptedErr := time.Parse(time.RFC3339Nano, s.Accepted)
	if !ok || s.Runner != runner || s.Runner != entry.Runner || s.Digest != entry.Digest || !s.Environment.Valid() ||
		s.Environment.Sandbox != entry.Sandbox || !uuid.MatchString(s.CurriculumID) || !uuid.MatchString(s.Submission) ||
		!uuid.MatchString(s.Learner) || !uuid.MatchString(s.Cohort) || !uuid.MatchString(s.Source.ID) ||
		!hash.MatchString(s.Content) || !hash.MatchString(s.Subject) || !hash.MatchString(s.Configuration) ||
		!hash.MatchString(s.SpecDigest) || s.Ordinal < 1 || acceptedErr != nil || !commit.MatchString(s.Commit) || s.Version == "" || s.CurriculumKey == "" || s.Source.Bucket != "nextera-submissions" ||
		!hash.MatchString(s.Source.Digest) || s.Source.Size < 1 || s.Source.Size > 262144 {
		return s, "", ErrIdentity
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(c.Snapshot, &m) != nil {
		return s, "", ErrIdentity
	}
	for _, k := range []string{"curriculum_version_id", "git_commit_sha", "evaluation_spec_digest", "learner_id", "cohort_id", "submission_id", "learner_attempt_ordinal", "accepted_at", "artifact"} {
		delete(m, k)
	}
	spec, _ := json.Marshal(m)
	expected, _ := Digest(spec, "nextera-evaluation-spec")
	if expected != s.SpecDigest {
		return s, "", ErrIdentity
	}
	parts := strings.Split(s.Source.Key, "/")
	if len(parts) != 4 || !uuid.MatchString(parts[0]) || parts[1] != s.Cohort || !uuid.MatchString(parts[2]) || parts[3] != s.Source.Digest {
		return s, "", ErrIdentity
	}
	filename := "hello.go"
	node := "hello-go"
	if s.PackID == "even-or-odd-v1" {
		filename = "even_or_odd.go"
		node = "even-or-odd"
	}
	if s.Source.Filename != filename || s.Node != node {
		return s, "", ErrIdentity
	}
	layout := filepath.Join(layouts, s.PackID)
	if s.Artifact == nil {
		return s, "", ErrIdentity
	}
	if s.TestOnly {
		u, e := url.Parse(*s.Artifact)
		if !local || e != nil || u.Scheme != "oci" || u.Host != "" || u.RawQuery != "" || u.Fragment != "" ||
			u.Path != layout+"@sha256:"+s.Digest || !strings.HasPrefix(s.CurriculumKey, "foundation-test-only-") {
			return s, "", ErrIdentity
		}
	} else if entry.Artifact == nil || *s.Artifact != *entry.Artifact {
		return s, "", ErrIdentity
	}
	if artifact.Verify(layout, s.PackID, entry) != nil {
		return s, "", errors.New("ARTIFACT_MISMATCH")
	}
	return s, layout, nil
}
