package protocol

import (
	"encoding/json"
	"nextera.local/runner/internal/artifact"
	"strings"
	"testing"
)

func TestCanonicalIdentity(t *testing.T) {
	a, err := Digest([]byte(`{"z":[2,1],"a":{"b":"<public>","a":1}}`), "nextera-evaluation-snapshot")
	b, _ := Digest([]byte(`{"a":{"a":1,"b":"<public>"},"z":[2,1]}`), "nextera-evaluation-snapshot")
	c, _ := Digest([]byte(`{"a":{"a":1,"b":"<public>"},"z":[1,2]}`), "nextera-evaluation-snapshot")
	if err != nil || a != b || a == c {
		t.Fatal("canonical identity changed with object order or ignored array order")
	}
}
func TestIdentityMismatchNeverBecomesLearnerFailure(t *testing.T) {
	entry := artifact.Entry{Digest: strings.Repeat("a", 64), Runner: "sha256:" + strings.Repeat("b", 64), Environment: artifact.Environment{
		Sandbox: "sha256:" + strings.Repeat("c", 64), Toolchain: artifact.Toolchain, Platform: artifact.Platform,
		Flags: []string{"-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid="}, Dependencies: "offline", Profile: artifact.Profile, Resources: artifact.PilotResources(), Protocol: 1, Snapshot: 1, Generation: artifact.Generation{Mode: "static"}}}
	catalog := artifact.Catalog{Format: 1, Packs: map[string]artifact.Entry{"hello-go-v1": entry}}
	makeSnapshot := func() Snapshot {
		id := "11111111-1111-1111-1111-111111111111"
		ref := "oci:///protected/hello-go-v1@sha256:" + entry.Digest
		s := Snapshot{Entry: entry, PackID: "hello-go-v1", CurriculumID: id, CurriculumKey: "foundation-test-only-public", Version: "0.1.0-test", Commit: strings.Repeat("d", 40), Content: strings.Repeat("e", 64), Node: "hello-go", Subject: strings.Repeat("f", 64), Configuration: strings.Repeat("a", 64), Learner: id, Cohort: id, Submission: id, Ordinal: 1, Accepted: "2026-10-18T00:00:00Z", TestOnly: true,
			Source: Source{ID: id, Bucket: "nextera-submissions", Key: id + "/" + id + "/" + id + "/" + strings.Repeat("a", 64), Filename: "hello.go", Size: 1, Digest: strings.Repeat("a", 64)}}
		s.Artifact = &ref
		return s
	}
	claimFor := func(s Snapshot) Claim {
		raw, _ := json.Marshal(s)
		var spec map[string]json.RawMessage
		_ = json.Unmarshal(raw, &spec)
		for _, k := range []string{"curriculum_version_id", "git_commit_sha", "evaluation_spec_digest", "learner_id", "cohort_id", "submission_id", "learner_attempt_ordinal", "accepted_at", "artifact"} {
			delete(spec, k)
		}
		body, _ := json.Marshal(spec)
		s.SpecDigest, _ = Digest(body, "nextera-evaluation-spec")
		raw, _ = json.Marshal(s)
		digest, _ := Digest(raw, "nextera-evaluation-snapshot")
		return Claim{Snapshot: raw, Digest: digest}
	}
	if _, _, err := Verify(claimFor(makeSnapshot()), catalog, entry.Runner, "/protected", true); err == nil || err.Error() != "ARTIFACT_MISMATCH" {
		t.Fatal("baseline must reach the missing-artifact boundary")
	}
	for _, mutate := range []func(*Snapshot){
		func(s *Snapshot) { s.Protocol = 2 }, func(s *Snapshot) { s.Snapshot = 2 }, func(s *Snapshot) { s.Runner = "sha256:" + strings.Repeat("0", 64) },
		func(s *Snapshot) { s.Sandbox = "sha256:" + strings.Repeat("0", 64) }, func(s *Snapshot) { s.Toolchain = "go0.0.0" },
		func(s *Snapshot) {
			s.Contract = &artifact.ExecutionContract{Version: 1, Item: "injected", File: "hello.go", Function: "Injected", Input: "string", Output: "string"}
		},
		func(s *Snapshot) { s.Digest = strings.Repeat("0", 64) },
		func(s *Snapshot) { s.Source.Filename = "other.go" },
		func(s *Snapshot) { s.Profile = "other" },
		func(s *Snapshot) { s.Platform = "linux/arm64" },
	} {
		s := makeSnapshot()
		mutate(&s)
		_, _, err := Verify(claimFor(s), catalog, entry.Runner, "/protected", true)
		if err != ErrIdentity {
			t.Fatal("incompatible identity accepted")
		}
	}
	if _, _, err := Verify(Claim{Snapshot: []byte(`{}`), Digest: strings.Repeat("0", 64)}, catalog, entry.Runner, "/protected", true); err == nil {
		t.Fatal("snapshot digest mismatch accepted")
	}
}
