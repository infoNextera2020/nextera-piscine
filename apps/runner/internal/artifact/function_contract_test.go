package artifact

import "testing"

func TestFunctionABI3AcceptsOnlyApprovedProfiles(t *testing.T) {
	for _, row := range [][2]string{{"int_int", "int"}, {"pointer_int_int", "pointer_int"}, {"int_slice_int_int", "int_slice_preserved"}, {"string", "int"}, {"int_slice", "int_slice_preserved"}} {
		c := ExecutionContract{3, "fixture-function", "original-name.go", "Fixture", row[0], row[1]}
		if got, err := ContractFor("fixture-function-v3", &c); err != nil || got != c {
			t.Fatal("approved signature rejected", row, err)
		}
		for _, mutate := range []func(*ExecutionContract){
			func(v *ExecutionContract) { v.Version = 4 },
			func(v *ExecutionContract) { v.File = "../original.go" },
			func(v *ExecutionContract) { v.File = "main.go" },
			func(v *ExecutionContract) { v.File = "source.go;echo" },
			func(v *ExecutionContract) { v.Function = "fixture" },
			func(v *ExecutionContract) { v.Input = "any" },
			func(v *ExecutionContract) { v.Output = "string" },
		} {
			bad := c
			mutate(&bad)
			if _, err := ContractFor("fixture-function-v3", &bad); err == nil {
				t.Fatal("unsupported function contract accepted", bad)
			}
		}
		for _, legacy := range []string{"hello-go-v1", "even-or-odd-v1"} {
			if _, err := ContractFor(legacy, &c); err == nil {
				t.Fatal("ABI3 replaced legacy contract")
			}
		}
	}
	for _, row := range [][2]string{{"int_slice", "int"}, {"int_slice_int_int", "int"}, {"pointer_int_int", "int"}, {"int_int", "pointer_int"}, {"int64", "int"}} {
		c := ExecutionContract{3, "fixture-function", "fixture.go", "Fixture", row[0], row[1]}
		if _, err := ContractFor("fixture-function-v3", &c); err == nil {
			t.Fatal("incomplete preservation/signature contract accepted", row)
		}
	}
}
