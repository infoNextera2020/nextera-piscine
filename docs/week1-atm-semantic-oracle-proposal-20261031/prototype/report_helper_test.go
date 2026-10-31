package main

import (
	"encoding/json"
	"io"
	"os"
	"reflect"
	"testing"
)

func reportBytes(t *testing.T, run func()) []byte {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	os.Stdout = writer
	defer func() { os.Stdout = original; reader.Close(); writer.Close() }()
	run()
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestReportSixEvents(t *testing.T) {
	balance := 125
	got := reportBytes(t, func() {
		Report("menu", &balance)
		Report("amount", &balance)
		Report("balance", &balance)
		Report("accepted", &balance)
		Report("rejected", &balance)
		Report("end", &balance)
	})
	want := "[\"menu\",125]\n[\"amount\",125]\n[\"balance\",125]\n[\"accepted\",125]\n[\"rejected\",125]\n[\"end\",125]\n"
	if string(got) != want {
		t.Fatalf("wrong JSON records: %q", got)
	}
	if balance != 125 {
		t.Fatal("provided reporter changed learner state")
	}
}

func TestReportUnauthenticatedNull(t *testing.T) {
	got := reportBytes(t, func() { Report("rejected", nil); Report("end", nil) })
	if string(got) != "[\"rejected\",null]\n[\"end\",null]\n" {
		t.Fatalf("wrong unauthenticated records: %q", got)
	}
}

func TestReportZeroIsNotNull(t *testing.T) {
	zero := 0
	got := reportBytes(t, func() { Report("balance", &zero); Report("end", &zero) })
	if string(got) != "[\"balance\",0]\n[\"end\",0]\n" {
		t.Fatalf("zero balance lost: %q", got)
	}
}

func TestReportRejectsMalformedCallBeforeWriting(t *testing.T) {
	negative, over, normal := -1, 10001, 100
	cases := []struct {
		name    string
		event   string
		balance *int
	}{
		{"unknown", "PASS", &normal}, {"newline", "menu\n", &normal},
		{"menu-null", "menu", nil}, {"amount-null", "amount", nil},
		{"balance-null", "balance", nil}, {"accepted-null", "accepted", nil},
		{"negative", "end", &negative}, {"over-cap", "balance", &over},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			panicked := false
			got := reportBytes(t, func() {
				func() {
					defer func() { panicked = recover() != nil }()
					Report(c.event, c.balance)
				}()
			})
			if !panicked || len(got) != 0 {
				t.Fatalf("malformed report was not stopped: panic=%v bytes=%q", panicked, got)
			}
		})
	}
}

func TestReportStopsIfStdoutUnavailable(t *testing.T) {
	original := os.Stdout
	os.Stdout = nil
	defer func() { os.Stdout = original }()
	balance := 100
	panicked := false
	func() {
		defer func() { panicked = recover() != nil }()
		Report("end", &balance)
	}()
	if !panicked {
		t.Fatal("report output failure was silently ignored")
	}
}

func TestReportRemainsObservationNotBusinessAuthority(t *testing.T) {
	// Structurally valid but potentially incorrect state is emitted faithfully.
	// The independent model, not this supplied serializer, decides its correctness.
	wrongBalance := 999
	got := reportBytes(t, func() { Report("balance", &wrongBalance) })
	var record []any
	if err := json.Unmarshal(got, &record); err != nil || !reflect.DeepEqual(record, []any{"balance", float64(999)}) {
		t.Fatalf("serializer invented a business result: %q %v", got, err)
	}
}
