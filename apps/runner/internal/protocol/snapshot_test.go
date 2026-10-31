package protocol

import (
	"encoding/json"
	"nextera.local/runner/internal/artifact"
	"path/filepath"
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

func storagePathSnapshot(t *testing.T, pack string, declared *artifact.ExecutionContract) (Snapshot, artifact.Catalog, string) {
	t.Helper()
	entry := artifact.Entry{Contract: declared, Digest: strings.Repeat("a", 64), Runner: "sha256:" + strings.Repeat("b", 64), Environment: artifact.Environment{
		Sandbox: "sha256:" + strings.Repeat("c", 64), Toolchain: artifact.Toolchain, Platform: artifact.Platform,
		Flags: []string{"-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid="}, Dependencies: "offline", Profile: artifact.Profile, Resources: artifact.PilotResources(), Protocol: 1, Snapshot: 1, Generation: artifact.Generation{Mode: "static"}}}
	contract, err := artifact.ContractFor(pack, declared)
	if err != nil {
		t.Fatal("invalid trusted test contract:", err)
	}
	layouts := t.TempDir()
	ref := "oci://" + filepath.Join(layouts, pack) + "@sha256:" + entry.Digest
	s := Snapshot{
		Entry: entry, PackID: pack, CurriculumID: "55555555-5555-5555-5555-555555555555",
		CurriculumKey: "foundation-test-only-storage-path", Version: "0.1.0-test", Commit: strings.Repeat("d", 40),
		Content: strings.Repeat("e", 64), Node: "existing-checkpoint-node", Subject: strings.Repeat("f", 64), Configuration: strings.Repeat("a", 64),
		Learner: "11111111-1111-1111-1111-111111111111", Cohort: "22222222-2222-2222-2222-222222222222",
		Submission: "44444444-4444-4444-4444-444444444444", Ordinal: 1, Accepted: "2026-10-31T00:00:00Z", TestOnly: true,
		Source: Source{ID: "33333333-3333-3333-3333-333333333333", Bucket: "nextera-submissions", Filename: contract.File, Size: 1, Digest: strings.Repeat("9", 64)},
	}
	if declared == nil {
		s.Node = contract.Item
	}
	s.Artifact = &ref
	s.Source.Key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/" + s.Cohort + "/scored-exam-v1/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/" + contract.Item + "/cccccccc-cccc-4ccc-8ccc-cccccccccccc/" + s.Source.Digest
	return s, artifact.Catalog{Format: 1, Packs: map[string]artifact.Entry{pack: entry}}, layouts
}

func storagePathClaim(t *testing.T, s Snapshot) Claim {
	t.Helper()
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var spec map[string]json.RawMessage
	if err = json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"curriculum_version_id", "git_commit_sha", "evaluation_spec_digest", "learner_id", "cohort_id", "submission_id", "learner_attempt_ordinal", "accepted_at", "artifact"} {
		delete(spec, k)
	}
	body, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	s.SpecDigest, err = Digest(body, "nextera-evaluation-spec")
	if err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := Digest(raw, "nextera-evaluation-snapshot")
	if err != nil {
		t.Fatal(err)
	}
	// This is a runner job attempt, deliberately unrelated to the key's
	// checkpoint attempt. Neither it nor the learner ID is an auth owner ID.
	return Claim{Attempt: "66666666-6666-6666-6666-666666666666", Snapshot: raw, Digest: digest}
}

func TestScoredExamStorageKeyAcceptsBoundTasks(t *testing.T) {
	for _, task := range []string{"q1", "q2", "q3", "q4", "q5"} {
		t.Run(task, func(t *testing.T) {
			contract := &artifact.ExecutionContract{Version: 3, Item: task, File: "answer.go", Function: "Answer", Input: "int_int", Output: "int"}
			s, catalog, layouts := storagePathSnapshot(t, "exam-function-v1", contract)
			if _, _, err := Verify(storagePathClaim(t, s), catalog, s.Runner, layouts, true); err == nil || err.Error() != "ARTIFACT_MISMATCH" {
				t.Fatalf("valid scoped key must reach missing private-pack boundary, got %v", err)
			}
		})
	}
}

func TestScoredExamStorageKeyRejectsMalformedOrUnboundPaths(t *testing.T) {
	contract := &artifact.ExecutionContract{Version: 3, Item: "q1", File: "answer.go", Function: "Answer", Input: "int_int", Output: "int"}
	base, _, _ := storagePathSnapshot(t, "exam-function-v1", contract)
	key := base.Source.Key
	segment := func(index int, value string) string {
		parts := strings.Split(key, "/")
		parts[index] = value
		return strings.Join(parts, "/")
	}
	for _, tt := range []struct{ name, key string }{
		{"missing-segment", strings.Join(strings.Split(key, "/")[:6], "/")},
		{"extra-segment", key + "/extra"},
		{"leading-slash", "/" + key},
		{"trailing-slash", key + "/"},
		{"empty-owner", segment(0, "")},
		{"malformed-owner", segment(0, "owner")},
		{"uppercase-owner", segment(0, "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")},
		{"compact-owner", segment(0, "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa")},
		{"owner-traversal", segment(0, "..")},
		{"cohort-mismatch", segment(1, "77777777-7777-7777-7777-777777777777")},
		{"escaped-cohort", segment(1, "%32"+base.Cohort[1:])},
		{"wrong-namespace", segment(2, "scored-exam-v2")},
		{"namespace-traversal", segment(2, "..")},
		{"empty-attempt", segment(3, "")},
		{"malformed-attempt", segment(3, "attempt")},
		{"uppercase-attempt", segment(3, "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB")},
		{"escaped-attempt", segment(3, "%2e%2e")},
		{"attempt-traversal", segment(3, "../attempt")},
		{"attempt-backslash", segment(3, "..\\attempt")},
		{"url-attempt", segment(3, "https://example.test/attempt")},
		{"drive-attempt", segment(3, "C:\\attempt")},
		{"task-mismatch", segment(4, "q2")},
		{"task-outside-coding-range", segment(4, "q6")},
		{"task-zero", segment(4, "q0")},
		{"task-uppercase", segment(4, "Q1")},
		{"task-zero-padded", segment(4, "q01")},
		{"empty-task", segment(4, "")},
		{"task-traversal", segment(4, "..")},
		{"empty-request", segment(5, "")},
		{"malformed-request", segment(5, "request")},
		{"uppercase-request", segment(5, "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC")},
		{"escaped-request", segment(5, "%2f")},
		{"request-traversal", segment(5, "../request")},
		{"request-query", segment(5, "cccccccc-cccc-4ccc-8ccc-cccccccccccc?x=1")},
		{"request-fragment", segment(5, "cccccccc-cccc-4ccc-8ccc-cccccccccccc#x")},
		{"request-null", segment(5, "cccccccc-cccc-4ccc-8ccc-cccccccccccc\x00")},
		{"request-newline", segment(5, "cccccccc-cccc-4ccc-8ccc-cccccccccccc\n")},
		{"digest-mismatch", segment(6, strings.Repeat("8", 64))},
		{"uppercase-digest", segment(6, strings.Repeat("A", 64))},
		{"short-digest", segment(6, strings.Repeat("9", 63))},
		{"nonhex-digest", segment(6, strings.Repeat("g", 64))},
		{"escaped-digest", segment(6, "%39"+strings.Repeat("9", 63))},
		{"digest-traversal", segment(6, "../"+base.Source.Digest)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s, catalog, layouts := storagePathSnapshot(t, "exam-function-v1", contract)
			s.Source.Key = tt.key
			if _, _, err := Verify(storagePathClaim(t, s), catalog, s.Runner, layouts, true); err != ErrIdentity {
				t.Fatalf("malformed or unbound storage key accepted: %v", err)
			}
		})
	}
}

func TestScoredExamStorageKeyRequiresTrustedABI3Task(t *testing.T) {
	for _, tt := range []struct {
		name, pack string
		contract   *artifact.ExecutionContract
	}{
		{"implicit-abi1", "hello-go-v1", nil},
		{"explicit-abi1", "function-v1", &artifact.ExecutionContract{Version: 1, Item: "q1", File: "answer.go", Function: "Answer", Input: "int64", Output: "string"}},
		{"program-abi2", "program-v1", &artifact.ExecutionContract{Version: 2, Item: "q1", File: "main.go", Input: "stdin_utf8", Output: "stdout_utf8_exact"}},
		{"abi3-quest-item", "function-v3", &artifact.ExecutionContract{Version: 3, Item: "quest-task", File: "answer.go", Function: "Answer", Input: "int_int", Output: "int"}},
		{"abi3-q6", "function-v3", &artifact.ExecutionContract{Version: 3, Item: "q6", File: "answer.go", Function: "Answer", Input: "int_int", Output: "int"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s, catalog, layouts := storagePathSnapshot(t, tt.pack, tt.contract)
			if _, _, err := Verify(storagePathClaim(t, s), catalog, s.Runner, layouts, true); err != ErrIdentity {
				t.Fatalf("seven-segment key accepted outside trusted ABI3 coding task: %v", err)
			}
		})
	}
	t.Run("snapshot-contract-cannot-override-catalog", func(t *testing.T) {
		declared := &artifact.ExecutionContract{Version: 1, Item: "q1", File: "answer.go", Function: "Answer", Input: "int64", Output: "string"}
		s, catalog, layouts := storagePathSnapshot(t, "function-v1", declared)
		s.Contract = &artifact.ExecutionContract{Version: 3, Item: "q1", File: "answer.go", Function: "Answer", Input: "int_int", Output: "int"}
		if _, _, err := Verify(storagePathClaim(t, s), catalog, s.Runner, layouts, true); err != ErrIdentity {
			t.Fatalf("snapshot contract overrode trusted catalog: %v", err)
		}
	})
}

func TestScoredExamStorageKeyBindsSnapshotDigest(t *testing.T) {
	contract := &artifact.ExecutionContract{Version: 3, Item: "q1", File: "answer.go", Function: "Answer", Input: "int_int", Output: "int"}
	s, catalog, layouts := storagePathSnapshot(t, "exam-function-v1", contract)
	claim := storagePathClaim(t, s)
	claim.Snapshot = []byte(strings.Replace(string(claim.Snapshot), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", 1))
	if _, _, err := Verify(claim, catalog, s.Runner, layouts, true); err != ErrIdentity {
		t.Fatalf("key mutation without snapshot digest update accepted: %v", err)
	}
}

func TestLegacyStorageKeyCompatibility(t *testing.T) {
	for _, tt := range []struct {
		name, pack string
		contract   *artifact.ExecutionContract
	}{
		{"implicit-abi1", "hello-go-v1", nil},
		{"explicit-abi1", "function-v1", &artifact.ExecutionContract{Version: 1, Item: "quest-task", File: "answer.go", Function: "Answer", Input: "int64", Output: "string"}},
		{"program-abi2", "program-v1", &artifact.ExecutionContract{Version: 2, Item: "quest-task", File: "main.go", Input: "stdin_utf8", Output: "stdout_utf8_exact"}},
		{"abi3-coding-item", "function-v3", &artifact.ExecutionContract{Version: 3, Item: "q1", File: "answer.go", Function: "Answer", Input: "int_int", Output: "int"}},
		{"abi3-other-item", "function-v3", &artifact.ExecutionContract{Version: 3, Item: "quest-task", File: "answer.go", Function: "Answer", Input: "int_int", Output: "int"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s, catalog, layouts := storagePathSnapshot(t, tt.pack, tt.contract)
			// Legacy auth and request UUIDs remain distinct from internal
			// learner/submission IDs; the prior four-segment rule is exact.
			s.Source.Key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/" + s.Cohort + "/cccccccc-cccc-4ccc-8ccc-cccccccccccc/" + s.Source.Digest
			if _, _, err := Verify(storagePathClaim(t, s), catalog, s.Runner, layouts, true); err == nil || err.Error() != "ARTIFACT_MISMATCH" {
				t.Fatalf("legacy key no longer reaches missing private-pack boundary: %v", err)
			}
		})
	}
}
