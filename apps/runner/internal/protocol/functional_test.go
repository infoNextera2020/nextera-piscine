package protocol

import (
	"encoding/json"
	"nextera.local/runner/internal/artifact"
	"reflect"
	"strings"
	"testing"
)

func TestFunctionalHostReportBindsCompleteObservationsWithoutOracleBytes(t *testing.T) {
	s := Snapshot{VerifiedJob: "11111111-1111-1111-1111-111111111111", VerifiedDigest: strings.Repeat("a", 64),
		Submission: "22222222-2222-2222-2222-222222222222", PackID: "exam-q1", SpecDigest: strings.Repeat("b", 64), Source: Source{Digest: strings.Repeat("c", 64)},
		Entry: artifact.Entry{Digest: strings.Repeat("d", 64), Contract: &artifact.ExecutionContract{Version: 3, Item: "q1"}}}
	m := &artifact.ScoringManifest{Digest: strings.Repeat("e", 64), PublicDigest: strings.Repeat("f", 64), PrivateDigest: strings.Repeat("1", 64), CaseCount: 3,
		Groups: []artifact.ScoringGroup{{Key: "basic", Criteria: strings.Repeat("2", 64), Cases: []int{0, 1}}, {Key: "edge", Criteria: strings.Repeat("3", 64), Cases: []int{2}}}}
	for _, row := range []struct{ values, want []bool }{{[]bool{true, true, true}, []bool{true, true}}, {[]bool{true, false, true}, []bool{false, true}}, {[]bool{false, false, false}, []bool{false, false}}} {
		report, err := FunctionalFromObservations(s, m, row.values)
		if err != nil {
			t.Fatal(err)
		}
		got := []bool{report.Groups[0].Passed, report.Groups[1].Passed}
		if !reflect.DeepEqual(got, row.want) || report.EvaluationSnapshotDigest != s.VerifiedDigest || report.JobID != s.VerifiedJob || report.ArtifactSHA256 != s.Source.Digest {
			t.Fatal("wrong grouped host comparison or binding", report)
		}
		raw, _ := json.Marshal(report)
		for _, private := range []string{"input", "expected", "caseSha256", `"index"`, "cases/private.json"} {
			if strings.Contains(string(raw), private) {
				t.Fatal("private oracle escaped into report")
			}
		}
	}
	for _, values := range [][]bool{nil, {true}, {true, true, true, true}} {
		if report, err := FunctionalFromObservations(s, m, values); err == nil || report != nil {
			t.Fatal("partial observations became grades")
		}
	}
	s.VerifiedDigest = ""
	if report, err := FunctionalFromObservations(s, m, []bool{true, true, true}); err == nil || report != nil {
		t.Fatal("unbound snapshot acquired evidence")
	}
	s.VerifiedDigest = strings.Repeat("a", 64)
	raw, _ := json.Marshal(s)
	if strings.Contains(string(raw), s.VerifiedJob) || strings.Contains(string(raw), "Verified") {
		t.Fatal("host claim fields changed frozen wire snapshot")
	}
}
