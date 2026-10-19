package executor

import (
	"nextera.local/runner/internal/artifact"
	"strings"
	"testing"
)

func TestContractDrivenAdapter(t *testing.T) {
	for _, c := range []artifact.ExecutionContract{
		{Version: 1, Item: "transfer-string", File: "transfer.go", Function: "TransferString", Input: "string", Output: "string"},
		{Version: 1, Item: "transfer-int", File: "transfer.go", Function: "TransferInt", Input: "int64", Output: "string"},
	} {
		a := string(adapterFor(c))
		if !strings.Contains(a, c.Function+"(") || strings.Contains(a, "expected") || strings.Contains(a, "private") {
			t.Fatal("invalid bounded transport adapter")
		}
		input := `[{"input":"a","expected":"a"}]`
		if c.Input == "int64" {
			input = `[{"input":-2,"expected":"negative"}]`
		}
		if _, _, err := casesFor(map[string][]byte{"cases/public.json": []byte(input), "cases/private.json": []byte(input)}, c); err != nil {
			t.Fatal("contract case types rejected")
		}
	}
}
