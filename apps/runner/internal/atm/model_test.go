package atm

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"nextera.local/runner/internal/artifact"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func trace(events []Event) []byte {
	var out bytes.Buffer
	for _, e := range events {
		raw, _ := json.Marshal([]any{e.Kind, e.Balance})
		out.Write(raw)
		out.WriteByte('\n')
	}
	return out.Bytes()
}
func TestApprovedModelKnownJourneys(t *testing.T) {
	for _, row := range []struct{ in, want string }{
		{"", "[\"end\",null]\n"},
		{"\n", "[\"rejected\",null]\n[\"end\",null]\n"},
		{"x\n\nx\n0427\n", "[\"rejected\",null]\n[\"rejected\",null]\n[\"rejected\",null]\n[\"end\",null]\n"},
		{"0427\r\n2\r\n25\r\n1\r\n4\r", "[\"menu\",100]\n[\"amount\",100]\n[\"accepted\",125]\n[\"menu\",125]\n[\"balance\",125]\n[\"menu\",125]\n[\"end\",125]\n"},
		{"0427\n3\n100\n4", "[\"menu\",100]\n[\"amount\",100]\n[\"accepted\",0]\n[\"menu\",0]\n[\"end\",0]\n"},
		{"0427\n2", "[\"menu\",100]\n[\"amount\",100]\n[\"end\",100]\n"},
	} {
		events, err := Expected([]byte(row.in), 65536)
		if err != nil || string(trace(events)) != row.want {
			t.Fatal("approved journey mismatch", err)
		}
		ok, err := Match([]byte(row.in), []byte(row.want), 65536)
		if err != nil || !ok {
			t.Fatal("own exact trace rejected", err)
		}
	}
}
func TestApprovedAmountAndStateRules(t *testing.T) {
	for _, amount := range []string{"0", "1001", "10000", "000001", "-1", "+1", "1.5", " 25", "25 ", "25x", "", "٢٥"} {
		in := "0427\n2\n25\n2\n" + amount + "\n3\n40\n1\n4\n"
		e, err := Expected([]byte(in), 65536)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.HasSuffix(trace(e), []byte("[\"balance\",85]\n[\"menu\",85]\n[\"end\",85]\n")) {
			t.Fatal("rejection erased earlier committed work")
		}
	}
	for _, amount := range []string{"25", "00025"} {
		e, _ := Expected([]byte("0427\n2\n"+amount+"\n4"), 65536)
		if !bytes.Contains(trace(e), []byte("[\"accepted\",125]")) {
			t.Fatal("leading zeros/range changed")
		}
	}
	base := "0427\n" + strings.Repeat("2\n1000\n", 9) + "2\n400\n2\n"
	for _, row := range []struct{ amount, last string }{{"500", "10000"}, {"501", "9500"}} {
		e, err := Expected([]byte(base+row.amount+"\n4"), 65536)
		if err != nil || !bytes.HasSuffix(trace(e), []byte("[\"end\","+row.last+"]\n")) {
			t.Fatal("cap changed", err)
		}
	}
}
func TestInputContractIncludesUnusedTrailingLines(t *testing.T) {
	for _, in := range [][]byte{[]byte("0427\n4\n" + strings.Repeat("x", 21)), append([]byte("0427\n4\n"), 255)} {
		if _, err := Expected(in, 65536); err != ErrInput {
			t.Fatal("outside input was learner failure")
		}
	}
	if _, err := Expected([]byte("0427\n"+strings.Repeat("٢", 20)), 65536); err != nil {
		t.Fatal("20-rune boundary became byte boundary")
	}
	if _, err := Expected([]byte("0427\n1\n"), 1); err != ErrInput {
		t.Fatal("host model grew beyond supplied output bound")
	}
}
func TestStrictOutputAndNoSelfReportedPASS(t *testing.T) {
	for _, bad := range []string{"PASS\n", "[\"pass\",100]\n", "[\"menu\",100.0]\n", "[\"menu\",1e2]\n", "[\"menu\",true]\n", "[\"menu\",\"100\"]\n", "[\"menu\",null]\n", "[\"end\",10001]\n", "[\"end\",-1]\n", "[\"end\",0,1]\n", "{\"end\":0}\n", "[\"end\",0] extra\n", "\x1b[0m[\"end\",0]\n"} {
		if _, err := Parse([]byte(bad)); err != ErrProjection {
			t.Fatal("invalid projection accepted")
		}
	}
	if _, err := Parse([]byte{255}); err != ErrProjection {
		t.Fatal("invalid UTF8 repaired")
	}
	for _, out := range []string{"", "[\"end\",100]\n", "[\"menu\",100]\n[\"end\",100]\n[\"end\",100]\n"} {
		ok, _ := Match([]byte("0427\n4"), []byte(out), 65536)
		if ok {
			t.Fatal("missing/extra/wrong records matched")
		}
	}
	ok, err := Match([]byte("0427\n4"), []byte(" \t\r\n [\"menu\",100] \r\n\n[\"end\",100]\t"), 65536)
	if err != nil || !ok {
		t.Fatal("permitted output edges rejected")
	}
}

// Optional source-preparation check: evaluates approved author-owned input bytes
// with the host model only. It never starts learner code or emits expected traces.
func TestATMPreparedInputSourceModelBudget(t *testing.T) {
	directory := os.Getenv("ATM_SOURCE_CASE_DIRECTORY")
	if directory == "" {
		t.Skip("no explicit author-owned input source directory")
	}
	remaining := artifact.PilotResources().Execution.Output
	count := 0
	for _, name := range []string{"public.json", "private.json"} {
		file, err := os.Open(filepath.Join(directory, name))
		if err != nil {
			t.Fatal("source input file unavailable")
		}
		raw, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
		_ = file.Close()
		var rows []struct {
			Input json.RawMessage `json:"input"`
		}
		if err != nil || len(raw) > 1<<20 || artifact.Strict(raw, &rows) != nil || len(rows) == 0 || len(rows) > 10000 {
			t.Fatal("source input grammar incompatible")
		}
		for _, row := range rows {
			var input string
			if len(row.Input) < 2 || row.Input[0] != '"' || json.Unmarshal(row.Input, &input) != nil {
				t.Fatal("source input must be a present JSON string")
			}
			events, err := ExpectedContext(context.Background(), []byte(input), remaining)
			if err != nil {
				t.Fatal("source case outside approved model/output budget")
			}
			remaining -= OutputBytes(events)
			count++
		}
	}
	t.Logf("author_owned_cases=%d aggregate_report_stdout_bytes=%d existing_output_budget_bytes=%d", count, artifact.PilotResources().Execution.Output-remaining, artifact.PilotResources().Execution.Output)
}
