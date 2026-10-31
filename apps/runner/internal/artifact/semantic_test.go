package artifact

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestATMSemanticProfileExactRootAndLegacyPresence(t *testing.T) {
	contract := ExecutionContract{4, "week1-atm", "main.go", "", "stdin_utf8", "atm_report_events_v1"}
	if _, err := ContractFor("atm-v1", &contract); err != nil {
		t.Fatal("declared ABI4 rejected")
	}
	for _, raw := range []json.RawMessage{nil, []byte(`null`), []byte(`""`), []byte(`"` + strings.Repeat("a", 64) + `"`)} {
		if ValidSemanticProfile(contract, raw) {
			t.Fatal("ABI4 profile defaulted")
		}
	}
	if !ValidSemanticProfile(contract, []byte(`"`+ATMSemanticProfileDigest+`"`)) {
		t.Fatal("approved profile rejected")
	}
	for _, version := range []int{1, 2, 3} {
		contract.Version = version
		if !ValidSemanticProfile(contract, nil) {
			t.Fatal("absent legacy field rejected")
		}
		for _, raw := range []json.RawMessage{[]byte(`null`), []byte(`""`), []byte(`"` + ATMSemanticProfileDigest + `"`)} {
			if ValidSemanticProfile(contract, raw) {
				t.Fatal("explicit legacy presence collapsed")
			}
		}
	}
	var entry Entry
	if Strict([]byte(`{"semantic_profile_digest":null}`), &entry) != nil || len(entry.SemanticProfileDigest) == 0 {
		t.Fatal("null/absence distinction lost")
	}
	if Strict([]byte(`{"semantic_profile_digest":"x","semantic_profile_digest":"x"}`), &entry) == nil {
		t.Fatal("duplicate profile accepted")
	}
}
