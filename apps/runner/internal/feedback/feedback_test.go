package feedback

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAllowlistedFeedback(t *testing.T) {
	for _, verdict := range []string{"passed", "failed", "compile_error", "runtime_error", "timeout", "system_error"} {
		b, err := json.Marshal(Project(verdict))
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]string
		if json.Unmarshal(b, &fields) != nil || len(fields) != 2 || fields["verdict"] != verdict {
			t.Fatal("unsafe feedback shape")
		}
	}
	for _, attack := range []string{"PASS", "private-case: expected=secret actual=secret", "/harness/private.go:123 panic", "stdout stderr"} {
		b, _ := json.Marshal(Project(attack))
		if strings.Contains(string(b), attack) || Project(attack).Verdict != "system_error" {
			t.Fatal("untrusted diagnostics crossed output boundary")
		}
	}
}
