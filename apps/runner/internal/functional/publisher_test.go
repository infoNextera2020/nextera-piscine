package functional

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"nextera.local/runner/internal/localdb"
	"nextera.local/runner/internal/protocol"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type goldenWire struct {
	Synthetic      bool                      `json:"synthetic"`
	Context        NativeContext             `json:"context"`
	Report         protocol.FunctionalReport `json:"report"`
	EvidenceDigest string                    `json:"evidenceDigest"`
	Body           body                      `json:"body"`
	PayloadDigest  string                    `json:"payloadDigest"`
}

func golden(t *testing.T) goldenWire {
	t.Helper()
	raw, err := os.ReadFile("testdata/wire-golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var v goldenWire
	if json.Unmarshal(raw, &v) != nil || !v.Synthetic {
		t.Fatal("synthetic golden missing")
	}
	return v
}
func testPublisher(t *testing.T) (*Publisher, goldenWire) {
	t.Helper()
	v := golden(t)
	directory := filepath.Join(t.TempDir(), "receipts")
	if os.Mkdir(directory, 0700) != nil {
		t.Fatal("fixture directory")
	}
	config := configuration{Version: 1, Routes: []route{{EvaluatorDigest: v.Report.EvaluationSpecDigest, DatabaseEnvironment: "NEXTERA_EXAM_FUNCTIONAL_UNIT_DSN"}},
		ReceiptDirectory: directory, MaxObjects: 3, MaxBytes: 262144, MaxEnvelopeBytes: 65536, PublicationTimeoutMs: 1000} // synthetic explicit capacity
	raw, _ := json.Marshal(config)
	file := filepath.Join(t.TempDir(), "publisher.json")
	if os.WriteFile(file, raw, 0600) != nil {
		t.Fatal("fixture config")
	}
	p, err := Load(file, func(name string) string {
		if name != "NEXTERA_EXAM_FUNCTIONAL_UNIT_DSN" {
			t.Fatal("credential fallback")
		}
		return "synthetic-restricted-evaluator-dsn"
	})
	if err != nil {
		t.Fatal(err)
	}
	return p, v
}
func ack(args []any) []byte {
	n := args[2].(string)
	var revision int64
	_, _ = fmt.Sscan(n, &revision)
	raw, _ := json.Marshal(map[string]any{"kind": "recorded", "eventId": "00000000-0000-0000-0000-000000000099",
		"operationId": args[0], "submissionId": args[1], "revision": fmt.Sprint(revision + 1), "payloadDigest": args[4], "replayed": false})
	return raw
}
func TestFunctionalPublisherMatchesTypeScriptGoldenAndRecordsPartialHostGroups(t *testing.T) {
	p, v := testPublisher(t)
	payload, digest, err := makeBody(v.Context, v.Report)
	if err != nil || digest != v.PayloadDigest || payload.Evidence.EvidenceDigest != v.EvidenceDigest || !reflect.DeepEqual(payload, v.Body) {
		t.Fatal("Go/TS canonical evidence framing drift", err, digest)
	}
	reads, writes := 0, 0
	p.call = func(_ context.Context, url, query string, args ...any) ([]byte, error) {
		if url != "synthetic-restricted-evaluator-dsn" {
			t.Fatal("general queue credential reused")
		}
		switch query {
		case ReadContextSQL:
			reads++
			if !reflect.DeepEqual(args, []any{v.Report.SubmissionID, v.Report.JobID}) {
				t.Fatal("wrong native context identity")
			}
			raw, _ := json.Marshal(v.Context)
			return raw, nil
		case RecordSQL:
			writes++
			entries, _ := os.ReadDir(p.config.ReceiptDirectory)
			if len(entries) != 1 {
				t.Fatal("native write preceded durable envelope")
			}
			raw, err := p.read(args[0].(string))
			if err != nil {
				t.Fatal("outbox not protected", err)
			}
			for _, private := range []string{"synthetic-restricted-evaluator-dsn", "databaseEnvironment", "expected\":", "caseSha256"} {
				if bytes.Contains(raw, []byte(private)) {
					t.Fatal("credential/private oracle in envelope")
				}
			}
			if args[2] != v.Context.ExpectedRevision || args[4] != v.PayloadDigest {
				t.Fatal("revision precision or payload drift")
			}
			var b body
			if json.Unmarshal([]byte(args[3].(string)), &b) != nil || !reflect.DeepEqual(b, v.Body) {
				t.Fatal("partial groups changed")
			}
			return ack(args), nil
		default:
			t.Fatal("unexpected SQL")
			return nil, nil
		}
	}
	prepared, err := p.Prepare(context.Background(), &v.Report)
	if err != nil {
		t.Fatal(err)
	}
	// Caller mutation after preparation cannot change the captured operation.
	v.Report.Groups[0].Passed = true
	if err = prepared.Publish(context.Background()); err != nil || reads != 1 || writes != 1 {
		t.Fatal("publication failed", err, reads, writes)
	}
}
func TestFunctionalUnknownWriteReplaysOnlyOriginalDurableEnvelope(t *testing.T) {
	p, v := testPublisher(t)
	var parameters [][]any
	reads := 0
	p.call = func(_ context.Context, _ string, query string, args ...any) ([]byte, error) {
		if query == ReadContextSQL {
			reads++
			raw, _ := json.Marshal(v.Context)
			return raw, nil
		}
		parameters = append(parameters, append([]any(nil), args...))
		if len(parameters) == 1 {
			return nil, errors.New("synthetic lost acknowledgement")
		}
		return ack(args), nil
	}
	prepared, err := p.Prepare(context.Background(), &v.Report)
	if err != nil {
		t.Fatal(err)
	}
	if err = prepared.Publish(context.Background()); !errors.Is(err, ErrUnknown) {
		t.Fatal("lost acknowledgement falsely denied or accepted")
	}
	operation := prepared.OperationID()
	// A changed current context cannot rebind replay because replay never reads it.
	v.Context.ExpectedRevision = "999"
	v.Context.Groups[0].CriteriaDigest = strings.Repeat("f", 64)
	if err = p.Replay(context.Background(), operation); err != nil || reads != 1 || len(parameters) != 2 || !reflect.DeepEqual(parameters[0], parameters[1]) {
		t.Fatal("unknown write rebound/new operation", err, reads, parameters)
	}
	entries, _ := os.ReadDir(p.config.ReceiptDirectory)
	if len(entries) != 1 {
		t.Fatal("immutable receipt was removed or duplicated")
	}
}
func TestFunctionalPublisherMissingOrUnboundEvidenceNeverWrites(t *testing.T) {
	for _, field := range []string{"missing-report", "snapshot", "rubric-source", "manifest", "case-count", "criteria", "route", "revision"} {
		t.Run(field, func(t *testing.T) {
			p, v := testPublisher(t)
			writes, reads := 0, 0
			switch field {
			case "snapshot":
				v.Context.EvaluationSnapshotDigest = strings.Repeat("f", 64)
			case "rubric-source":
				v.Context.RubricSourceBindingDigest = ""
			case "manifest":
				v.Context.ManifestSHA256 = strings.Repeat("f", 64)
			case "case-count":
				v.Context.CaseCount--
			case "criteria":
				v.Context.Groups[0].CriteriaDigest = strings.Repeat("f", 64)
			case "route":
				v.Report.EvaluationSpecDigest = strings.Repeat("f", 64)
			case "revision":
				v.Context.ExpectedRevision = "9223372036854775807"
			}
			p.call = func(_ context.Context, _ string, query string, args ...any) ([]byte, error) {
				if query != ReadContextSQL {
					writes++
				}
				reads++
				raw, _ := json.Marshal(v.Context)
				return raw, nil
			}
			report := &v.Report
			if field == "missing-report" {
				report = nil
			}
			if prepared, err := p.Prepare(context.Background(), report); err == nil || prepared != nil || writes != 0 {
				t.Fatal("unproven report reached write")
			}
			entries, _ := os.ReadDir(p.config.ReceiptDirectory)
			if len(entries) != 0 {
				t.Fatal("invalid proof created envelope")
			}
			if (field == "missing-report" || field == "route") && reads != 0 {
				t.Fatal("unconfigured evidence caused SQL")
			}
		})
	}
}
func TestFunctionalOutboxCapacityAndTamperFailBeforeNativeWrite(t *testing.T) {
	p, v := testPublisher(t)
	p.config.MaxObjects = 1
	writes := 0
	p.call = func(_ context.Context, _ string, query string, args ...any) ([]byte, error) {
		if query == ReadContextSQL {
			raw, _ := json.Marshal(v.Context)
			return raw, nil
		}
		writes++
		return ack(args), nil
	}
	first, err := p.Prepare(context.Background(), &v.Report)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := p.Prepare(context.Background(), &v.Report); err == nil || second != nil {
		t.Fatal("capacity exceeded")
	}
	entries, _ := os.ReadDir(p.config.ReceiptDirectory)
	if len(entries) != 1 || writes != 0 {
		t.Fatal("capacity failure wrote native state or orphan file")
	}
	path := filepath.Join(p.config.ReceiptDirectory, first.OperationID()+".json")
	if os.WriteFile(path, []byte("{}"), 0600) != nil {
		t.Fatal("fixture tamper")
	}
	if first.Publish(context.Background()) == nil || p.Replay(context.Background(), first.OperationID()) == nil || writes != 0 {
		t.Fatal("tampered envelope reached native write")
	}
}
func TestFunctionalOutboxRejectsUnsafeFilesAndMissingCapacityPolicy(t *testing.T) {
	p, v := testPublisher(t)
	config := p.config
	config.MaxBytes = 0
	raw, _ := json.Marshal(config)
	file := filepath.Join(t.TempDir(), "config.json")
	_ = os.WriteFile(file, raw, 0600)
	if _, err := Load(file, func(string) string { return "synthetic" }); err == nil {
		t.Fatal("missing capacity defaulted")
	}
	config = p.config
	config.Routes[0].DatabaseEnvironment = "JUDGE_DATABASE_URL"
	raw, _ = json.Marshal(config)
	_ = os.WriteFile(file, raw, 0600)
	if _, err := Load(file, func(string) string { return "synthetic" }); err == nil {
		t.Fatal("worker credential fallback admitted")
	}
	p.call = func(_ context.Context, _ string, _ string, _ ...any) ([]byte, error) {
		raw, _ := json.Marshal(v.Context)
		return raw, nil
	}
	if os.Chmod(p.config.ReceiptDirectory, 0755) != nil {
		t.Fatal("fixture mode")
	}
	if _, err := p.Prepare(context.Background(), &v.Report); err == nil {
		t.Fatal("public outbox admitted")
	}
	_ = os.Chmod(p.config.ReceiptDirectory, 0700)
	target := filepath.Join(t.TempDir(), "unrelated.json")
	_ = os.WriteFile(target, []byte("{}"), 0600)
	op := "00000000-0000-0000-0000-000000000088"
	if os.Symlink(target, filepath.Join(p.config.ReceiptDirectory, op+".json")) != nil {
		t.Fatal("fixture symlink")
	}
	if p.Replay(context.Background(), op) == nil {
		t.Fatal("outbox followed symlink")
	}
	if _, err := p.Prepare(context.Background(), &v.Report); err == nil {
		t.Fatal("unsafe inventory allowed new native write")
	}
}
func TestFunctionalAcknowledgementMismatchStaysUnknownAndExplicitDenialDoesNotSucceed(t *testing.T) {
	for _, reply := range []string{`{"kind":"recorded","operationId":"wrong"}`, `{"kind":"forbidden"}`} {
		p, v := testPublisher(t)
		p.call = func(_ context.Context, _ string, query string, _ ...any) ([]byte, error) {
			if query == ReadContextSQL {
				raw, _ := json.Marshal(v.Context)
				return raw, nil
			}
			return []byte(reply), nil
		}
		prepared, err := p.Prepare(context.Background(), &v.Report)
		if err != nil {
			t.Fatal(err)
		}
		err = prepared.Publish(context.Background())
		if strings.Contains(reply, "recorded") && !errors.Is(err, ErrUnknown) {
			t.Fatal("malformed acknowledgement became known")
		}
		if strings.Contains(reply, "forbidden") && !errors.Is(err, ErrDenied) {
			t.Fatal("native denial became success")
		}
	}
}

func TestFunctionalLocalBindingRejectsEveryRouteBeforeAnySQLIncludingReplay(t *testing.T) {
	for _, bad := range []string{
		"postgres://eval:synthetic@remote.example:5432/foundation_test_unit?sslmode=disable",
		"postgres://eval:synthetic@127.0.0.1:6432/foundation_test_unit?sslmode=disable",
		"postgres://eval:synthetic@127.0.0.1:5432/foundation_test_other?sslmode=disable",
		"postgres://eval:synthetic@127.0.0.1:5432/foundation_test_unit?host=remote.example",
		"postgres://eval:synthetic@127.0.0.1:5432/foundation_test_unit?service=forbidden",
	} {
		p, v := testPublisher(t)
		calls := 0
		p.call = func(context.Context, string, string, ...any) ([]byte, error) {
			calls++
			t.Fatal("SQL sent after failed local binding")
			return nil, nil
		}
		p.routes[v.Report.EvaluationSpecDigest] = bad
		if p.BindLocalFixture(localdb.Target{Host: "127.0.0.1", Port: 5432, Database: "foundation_test_unit"}) == nil {
			t.Fatal("cross-target route accepted")
		}
		if p.Prepare(context.Background(), &v.Report); calls != 0 {
			t.Fatal("failed binding did not close producer")
		}
		if p.Replay(context.Background(), "00000000-0000-0000-0000-000000000099") == nil || calls != 0 {
			t.Fatal("replay escaped failed binding")
		}
	}
	p, v := testPublisher(t)
	good := "postgres://eval:synthetic-evaluator@127.0.0.1:5432/foundation_test_unit?sslmode=disable"
	p.routes[v.Report.EvaluationSpecDigest] = good
	p.routes[strings.Repeat("f", 64)] = "postgres://eval:synthetic@remote.example:5432/foundation_test_unit"
	if p.BindLocalFixture(localdb.Target{Host: "127.0.0.1", Port: 5432, Database: "foundation_test_unit"}) == nil {
		t.Fatal("only first configured route was checked")
	}
}

func TestFunctionalOriginalLocalTargetCannotBeRepointedOrBypassedByGenericReplay(t *testing.T) {
	p, v := testPublisher(t)
	original := localdb.Target{Host: "127.0.0.1", Port: 5432, Database: "foundation_test_unit"}
	originalURL := "postgres://eval:synthetic@127.0.0.1:5432/foundation_test_unit?sslmode=disable"
	p.routes[v.Report.EvaluationSpecDigest] = originalURL
	if p.BindLocalFixture(original) != nil {
		t.Fatal("fixture binding")
	}
	reads, writes := 0, 0
	p.call = func(_ context.Context, _ string, query string, args ...any) ([]byte, error) {
		if query == ReadContextSQL {
			reads++
			raw, _ := json.Marshal(v.Context)
			return raw, nil
		}
		writes++
		return ack(args), nil
	}
	prepared, err := p.Prepare(context.Background(), &v.Report)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.captured.LocalTarget == nil || *prepared.captured.LocalTarget != original {
		t.Fatal("original target not in protected envelope")
	}
	other := localdb.Target{Host: "127.0.0.1", Port: 5432, Database: "foundation_test_clone"}
	p.routes[v.Report.EvaluationSpecDigest] = "postgres://eval:synthetic@127.0.0.1:5432/foundation_test_clone?sslmode=disable"
	if p.BindLocalFixture(other) != nil {
		t.Fatal("synthetic second local anchor")
	}
	p.call = func(context.Context, string, string, ...any) ([]byte, error) {
		writes++
		t.Fatal("cross-target replay reached SQL")
		return nil, nil
	}
	if prepared.Publish(context.Background()) == nil || p.Replay(context.Background(), prepared.OperationID()) == nil || reads != 1 || writes != 0 {
		t.Fatal("successful rebind redirected an existing operation")
	}
	generic, _ := testPublisher(t)
	generic.config.ReceiptDirectory = p.config.ReceiptDirectory
	generic.call = func(context.Context, string, string, ...any) ([]byte, error) {
		writes++
		t.Fatal("generic bypass reached SQL")
		return nil, nil
	}
	if generic.Replay(context.Background(), prepared.OperationID()) == nil || writes != 0 {
		t.Fatal("generic publisher ignored local target metadata")
	}
}
func TestFunctionalLocalPublisherRejectsOldUnboundEnvelopeWithoutSQL(t *testing.T) {
	p, v := testPublisher(t)
	p.call = func(_ context.Context, _ string, query string, args ...any) ([]byte, error) {
		if query != ReadContextSQL {
			t.Fatal("unexpected write")
		}
		raw, _ := json.Marshal(v.Context)
		return raw, nil
	}
	prepared, err := p.Prepare(context.Background(), &v.Report)
	if err != nil {
		t.Fatal(err)
	}
	p.routes[v.Report.EvaluationSpecDigest] = "postgres://eval:synthetic@127.0.0.1:5432/foundation_test_unit?sslmode=disable"
	if p.BindLocalFixture(localdb.Target{Host: "127.0.0.1", Port: 5432, Database: "foundation_test_unit"}) != nil {
		t.Fatal("fixture binding")
	}
	calls := 0
	p.call = func(context.Context, string, string, ...any) ([]byte, error) {
		calls++
		t.Fatal("unbound envelope reached SQL")
		return nil, nil
	}
	if prepared.Publish(context.Background()) == nil || p.Replay(context.Background(), prepared.OperationID()) == nil || calls != 0 {
		t.Fatal("old unbound local envelope adopted")
	}
}
