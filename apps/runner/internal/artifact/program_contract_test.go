package artifact

import (
	"encoding/json"
	"testing"
)

func TestVersion2ProgramContractIsExplicitAndDigestBound(t *testing.T) {
	c := ExecutionContract{2, "greeting-card", "main.go", "", "stdin_utf8", "stdout_utf8_exact"}
	entry := testEntry()
	entry.Contract = &c
	catalog := Catalog{1, map[string]Entry{"greeting-program-v2": entry}}
	if catalog.Validate(true) != nil {
		t.Fatal("explicit program contract rejected")
	}
	path, verified := layout(t, "greeting-program-v2", entry)
	if Verify(path, "greeting-program-v2", verified) != nil {
		t.Fatal("valid digest-bound program metadata rejected")
	}
	tampered := c
	tampered.Item = "other-program"
	verified.Contract = &tampered
	if Verify(path, "greeting-program-v2", verified) == nil {
		t.Fatal("contract not bound to immutable artifact metadata")
	}
	for _, change := range []func(*ExecutionContract){
		func(v *ExecutionContract) { v.Version = 3 },
		func(v *ExecutionContract) { v.File = "../main.go" },
		func(v *ExecutionContract) { v.File = "input.go" },
		func(v *ExecutionContract) { v.File = "main.go extra.go" },
		func(v *ExecutionContract) { v.Function = "Main" },
		func(v *ExecutionContract) { v.Input = "string" },
		func(v *ExecutionContract) { v.Output = "string" },
		func(v *ExecutionContract) { v.Item = "greeting_card" },
	} {
		v := c
		change(&v)
		if _, err := ContractFor("greeting-program-v2", &v); err == nil {
			t.Fatal("ambiguous or unsafe program contract accepted", v)
		}
	}
	if _, err := ContractFor("greeting-program-v2", nil); err == nil {
		t.Fatal("program ABI inferred from pack name")
	}
	for _, legacy := range []string{"hello-go-v1", "even-or-odd-v1"} {
		if _, err := ContractFor(legacy, &c); err == nil {
			t.Fatal("legacy pack ID reinterpreted as a program")
		}
	}
	// Supporting the ABI must not select a policy or relax existing explicit limits.
	entry.Resources.Execution.Timeout++
	if (Catalog{1, map[string]Entry{"greeting-program-v2": entry}}).Validate(true) == nil {
		t.Fatal("program path weakened resource-profile checks")
	}
}

func TestLegacyExecutionContractSerializationUnchanged(t *testing.T) {
	for _, row := range []struct{ id, want string }{
		{"hello-go-v1", `{"version":1,"item_key":"hello-go","learner_file":"hello.go","function":"Hello","input_type":"string","output_type":"string"}`},
		{"even-or-odd-v1", `{"version":1,"item_key":"even-or-odd","learner_file":"even_or_odd.go","function":"EvenOrOdd","input_type":"int64","output_type":"string"}`},
	} {
		c, err := ContractFor(row.id, nil)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(c)
		if string(raw) != row.want {
			t.Fatal("legacy contract bytes changed", string(raw))
		}
	}
	v := ExecutionContract{1, "greeting-card", "main.go", "Hello", "string", "string"}
	if _, err := ContractFor("greeting-card", &v); err == nil {
		t.Fatal("v1 program filename unexpectedly admitted")
	}
}
