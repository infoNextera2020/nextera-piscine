package artifact

import (
	"encoding/json"
	"strings"
	"testing"
)

func scoringFixture(t *testing.T) (map[string][]byte, map[string]any, ExecutionContract) {
	t.Helper()
	public := []byte(`[{"input":{"a":1,"b":2},"expected":3},{"input":{"a":4,"b":2},"expected":6}]`)
	private := []byte(`[{"input":{"a":-1,"b":2},"expected":1}]`)
	var first, second []json.RawMessage
	_ = json.Unmarshal(public, &first)
	_ = json.Unmarshal(private, &second)
	refs := func(index int, raw []byte) map[string]any {
		return map[string]any{"index": index, "caseSha256": BytesDigest(raw)}
	}
	wire := map[string]any{"version": 1, "failureSemantics": CompleteObservationsOnly,
		"caseFiles": map[string]any{"publicSha256": BytesDigest(public), "privateSha256": BytesDigest(private)},
		"groups": []any{map[string]any{"groupKey": "basic", "criteriaDigest": strings.Repeat("a", 64), "cases": []any{refs(0, first[0]), refs(1, first[1])}},
			map[string]any{"groupKey": "edge", "criteriaDigest": strings.Repeat("b", 64), "cases": []any{refs(2, second[0])}}}}
	raw, _ := json.Marshal(wire)
	return map[string][]byte{"cases/public.json": public, "cases/private.json": private, ScoringManifestPath: raw}, wire,
		ExecutionContract{Version: 3, Item: "q1", File: "answer.go", Function: "Answer", Input: "int_int", Output: "int"}
}
func TestScoringManifestRequiresExplicitCompleteByteBoundClassification(t *testing.T) {
	files, _, contract := scoringFixture(t)
	m, err := LoadScoring(files, contract)
	if err != nil || m.CaseCount != 3 || len(m.Groups) != 2 || len(m.Groups[0].Cases) != 2 || m.Groups[1].Cases[0] != 2 {
		t.Fatal("valid synthetic group manifest rejected", err)
	}
	if m.Digest != BytesDigest(files[ScoringManifestPath]) {
		t.Fatal("manifest bytes not bound")
	}
	for _, test := range []struct {
		name   string
		mutate func(map[string][]byte, map[string]any)
	}{
		{"missing-profile", func(_ map[string][]byte, w map[string]any) { delete(w, "failureSemantics") }},
		{"unsupported-failure-policy", func(_ map[string][]byte, w map[string]any) { w["failureSemantics"] = "guess-all-groups-failed" }},
		{"unknown-field", func(_ map[string][]byte, w map[string]any) { w["points"] = 13 }},
		{"casefile-byte-tamper", func(f map[string][]byte, _ map[string]any) {
			f["cases/private.json"] = append(f["cases/private.json"], ' ')
		}},
		{"missing-group", func(_ map[string][]byte, w map[string]any) { w["groups"] = w["groups"].([]any)[:1] }},
		{"duplicate-group", func(_ map[string][]byte, w map[string]any) {
			g := w["groups"].([]any)
			g[1].(map[string]any)["groupKey"] = "basic"
		}},
		{"unknown-case-hash", func(_ map[string][]byte, w map[string]any) {
			g := w["groups"].([]any)[0].(map[string]any)
			g["cases"].([]any)[0].(map[string]any)["caseSha256"] = strings.Repeat("f", 64)
		}},
		{"missing-index", func(_ map[string][]byte, w map[string]any) {
			g := w["groups"].([]any)[0].(map[string]any)
			delete(g["cases"].([]any)[0].(map[string]any), "index")
		}},
		{"duplicate-index", func(_ map[string][]byte, w map[string]any) {
			g := w["groups"].([]any)[0].(map[string]any)
			g["cases"].([]any)[1] = g["cases"].([]any)[0]
		}},
		{"out-of-range", func(_ map[string][]byte, w map[string]any) {
			g := w["groups"].([]any)[0].(map[string]any)
			g["cases"].([]any)[0].(map[string]any)["index"] = 3
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			f, w, c := scoringFixture(t)
			test.mutate(f, w)
			f[ScoringManifestPath], _ = json.Marshal(w)
			if _, err := LoadScoring(f, c); err == nil {
				t.Fatal("invalid private manifest accepted")
			}
		})
	}
	delete(files, ScoringManifestPath)
	if m, err := LoadScoring(files, contract); err != nil || m != nil {
		t.Fatal("absent manifest must remain unresolved")
	}
	files, _, contract = scoringFixture(t)
	for _, item := range []string{"q6", "q8", "challenge"} {
		contract.Item = item
		if _, err := LoadScoring(files, contract); err == nil {
			t.Fatal("noncoding task acquired scoring semantics", item)
		}
	}
	contract.Item = "q1"
	contract.Version = 2
	if _, err := LoadScoring(files, contract); err == nil {
		t.Fatal("nonABI3 pack acquired scoring semantics")
	}
}
