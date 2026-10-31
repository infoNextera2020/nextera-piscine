// Package functional publishes host-only aggregate evidence with a separately
// configured, per-item evaluator principal. The ordinary queue client is never
// reused, elevated or given scoring/table/owner authority.
package functional

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/localdb"
	"nextera.local/runner/internal/protocol"
	"regexp"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrUnavailable = errors.New("FUNCTIONAL_PUBLICATION_UNAVAILABLE")
var ErrUnknown = errors.New("FUNCTIONAL_PUBLICATION_OUTCOME_UNKNOWN")
var ErrDenied = errors.New("FUNCTIONAL_PUBLICATION_DENIED")
var hash = regexp.MustCompile(`^[a-f0-9]{64}$`)
var uuid = regexp.MustCompile(`^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`)
var key = regexp.MustCompile(`^[a-z][a-z0-9-]{0,79}$`)
var envKey = regexp.MustCompile(`^NEXTERA_EXAM_FUNCTIONAL_[A-Z0-9_]+$`)
var decimal = regexp.MustCompile(`^(0|[1-9][0-9]{0,18})$`)

const ReadContextSQL = "SELECT app.scored_exam_functional_context($1::uuid,$2::uuid) AS data"
const RecordSQL = "SELECT app.record_exam_scoring_event(NULL,$1::uuid,$2::uuid,$3::bigint,'functional',$4::jsonb,$5) AS data"

type Group struct {
	GroupKey       string `json:"groupKey"`
	CriteriaDigest string `json:"criteriaDigest"`
}
type NativeContext struct {
	Version                   int     `json:"version"`
	SubmissionID              string  `json:"submissionId"`
	JobID                     string  `json:"jobId"`
	AttemptID                 string  `json:"attemptId"`
	LearnerID                 string  `json:"learnerId"`
	CohortID                  string  `json:"cohortId"`
	QuestionKey               string  `json:"questionKey"`
	AnswerSHA256              string  `json:"answerSha256"`
	DefinitionDigest          string  `json:"definitionDigest"`
	SnapshotDigest            string  `json:"snapshotDigest"`
	RubricDigest              string  `json:"rubricDigest"`
	RubricSourceBindingDigest string  `json:"rubricSourceBindingDigest"`
	PublishedCriteriaDigest   string  `json:"publishedCriteriaDigest"`
	EvaluatorKey              string  `json:"evaluatorKey"`
	EvaluatorDigest           string  `json:"evaluatorDigest"`
	EvaluationSnapshotDigest  string  `json:"evaluationSnapshotDigest"`
	EvaluationSpecDigest      string  `json:"evaluationSpecDigest"`
	TestPackID                string  `json:"testPackId"`
	TestPackDigest            string  `json:"testPackDigest"`
	ManifestSHA256            string  `json:"manifestSha256"`
	PublicCasesSHA256         string  `json:"publicCasesSha256"`
	PrivateCasesSHA256        string  `json:"privateCasesSha256"`
	CaseCount                 int     `json:"caseCount"`
	ManifestBindingDigest     string  `json:"manifestBindingDigest"`
	ExpectedRevision          string  `json:"expectedRevision"`
	Groups                    []Group `json:"groups"`
}
type route struct {
	EvaluatorDigest     string `json:"evaluatorDigest"`
	DatabaseEnvironment string `json:"databaseEnvironment"`
}
type configuration struct {
	Version              int     `json:"version"`
	Routes               []route `json:"routes"`
	ReceiptDirectory     string  `json:"receiptDirectory"`
	MaxObjects           int64   `json:"maxObjects"`
	MaxBytes             int64   `json:"maxBytes"`
	MaxEnvelopeBytes     int64   `json:"maxEnvelopeBytes"`
	PublicationTimeoutMs int     `json:"publicationTimeoutMs"`
}
type sqlCall func(context.Context, string, string, ...any) ([]byte, error)
type Publisher struct {
	config      configuration
	routes      map[string]string
	call        sqlCall
	localOnly   bool
	localBound  bool
	localTarget *localdb.Target
}
type evidence struct {
	SubmissionID            string                     `json:"submissionId"`
	QuestionKey             string                     `json:"questionKey"`
	AnswerSHA256            string                     `json:"answerSha256"`
	RubricDigest            string                     `json:"rubricDigest"`
	PublishedCriteriaDigest string                     `json:"publishedCriteriaDigest"`
	Kind                    string                     `json:"kind"`
	EvidenceDigest          string                     `json:"evidenceDigest"`
	Outcomes                []protocol.FunctionalGroup `json:"outcomes"`
}
type body struct {
	State    string   `json:"state"`
	Evidence evidence `json:"evidence"`
}
type envelope struct {
	Version     int                       `json:"version"`
	OperationID string                    `json:"operationId"`
	Context     NativeContext             `json:"context"`
	Report      protocol.FunctionalReport `json:"report"`
	Body        body                      `json:"body"`
	BodyDigest  string                    `json:"bodyDigest"`
	LocalTarget *localdb.Target           `json:"localTarget,omitempty"`
}
type Prepared struct {
	publisher *Publisher
	captured  envelope
	raw       []byte
	call      sqlCall
	route     string
}

func callSQL(ctx context.Context, url, query string, args ...any) ([]byte, error) {
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	connection, err := pgx.Connect(bounded, url)
	if err != nil {
		return nil, ErrUnknown
	}
	defer connection.Close(context.Background())
	var raw []byte
	if connection.QueryRow(bounded, query, args...).Scan(&raw) != nil {
		return nil, ErrUnknown
	}
	return raw, nil
}

func callFrozenSQL(ctx context.Context, config *pgx.ConnConfig, query string, args ...any) ([]byte, error) {
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	connection, err := pgx.ConnectConfig(bounded, config)
	if err != nil {
		return nil, ErrUnknown
	}
	defer connection.Close(context.Background())
	var raw []byte
	if connection.QueryRow(bounded, query, args...).Scan(&raw) != nil {
		return nil, ErrUnknown
	}
	return raw, nil
}

// Load reads only an explicit protected configuration. No fallback credential,
// numeric capacity default, role change, connection or publisher is created when
// the work flag is absent. Tests supply synthetic getenv/call implementations.
func Load(path string, getenv func(string) string) (*Publisher, error) {
	raw, err := readPrivate(path, 65536)
	if err != nil {
		return nil, ErrUnavailable
	}
	var config configuration
	if artifact.Strict(raw, &config) != nil || config.Version != 1 || len(config.Routes) == 0 || len(config.Routes) > 64 ||
		config.MaxObjects < 1 || config.MaxBytes < 1 || config.MaxEnvelopeBytes < 1 || config.MaxEnvelopeBytes > config.MaxBytes ||
		config.PublicationTimeoutMs < 1 || config.PublicationTimeoutMs > 2147483647 ||
		config.MaxBytes > 9007199254740991 {
		return nil, ErrUnavailable
	}
	publisher := &Publisher{config: config, routes: map[string]string{}, call: callSQL}
	if checkDirectory(config.ReceiptDirectory) != nil {
		return nil, ErrUnavailable
	}
	for _, r := range config.Routes {
		if !hash.MatchString(r.EvaluatorDigest) || !envKey.MatchString(r.DatabaseEnvironment) || publisher.routes[r.EvaluatorDigest] != "" {
			return nil, ErrUnavailable
		}
		url := getenv(r.DatabaseEnvironment)
		if url == "" {
			return nil, ErrUnavailable
		}
		publisher.routes[r.EvaluatorDigest] = url
	}
	return publisher, nil
}

// Publication has an explicit administrative bound, separate from the single
// frozen compilation/execution budget. No timing default enables publication.
func (p *Publisher) PublicationContext(parent context.Context) (context.Context, context.CancelFunc) {
	if p == nil || p.config.PublicationTimeoutMs < 1 {
		ctx, cancel := context.WithCancel(parent)
		cancel()
		return ctx, cancel
	}
	return context.WithTimeout(parent, time.Duration(p.config.PublicationTimeoutMs)*time.Millisecond)
}

func validate(context NativeContext, report protocol.FunctionalReport) error {
	if context.Version != 1 || report.Version != 1 || context.EvaluatorKey != "official-code" ||
		context.EvaluatorDigest != context.EvaluationSpecDigest || context.EvaluationSpecDigest != report.EvaluationSpecDigest ||
		context.SubmissionID != report.SubmissionID || context.JobID != report.JobID || context.QuestionKey != report.ItemKey ||
		context.AnswerSHA256 != report.ArtifactSHA256 || context.EvaluationSnapshotDigest != report.EvaluationSnapshotDigest ||
		context.TestPackID != report.TestPackID || context.TestPackDigest != report.TestPackDigest ||
		context.ManifestSHA256 != report.ManifestSHA256 || context.PublicCasesSHA256 != report.PublicCasesSHA256 ||
		context.PrivateCasesSHA256 != report.PrivateCasesSHA256 || context.CaseCount != report.CaseCount || context.CaseCount < 1 || context.CaseCount > 20000 ||
		len(report.Groups) == 0 || len(context.Groups) != len(report.Groups) || len(report.ItemKey) != 2 || report.ItemKey[0] != 'q' || report.ItemKey[1] < '1' || report.ItemKey[1] > '5' ||
		!decimal.MatchString(context.ExpectedRevision) {
		return ErrUnavailable
	}
	number, ok := new(big.Int).SetString(context.ExpectedRevision, 10)
	if !ok || number.Sign() < 0 || number.Cmp(big.NewInt(9223372036854775806)) > 0 {
		return ErrUnavailable
	}
	for _, value := range []string{context.SubmissionID, context.JobID, context.AttemptID, context.LearnerID, context.CohortID} {
		if !uuid.MatchString(value) {
			return ErrUnavailable
		}
	}
	for _, value := range []string{context.AnswerSHA256, context.DefinitionDigest, context.SnapshotDigest, context.RubricDigest, context.RubricSourceBindingDigest, context.PublishedCriteriaDigest,
		context.EvaluatorDigest, context.EvaluationSnapshotDigest, context.EvaluationSpecDigest, context.TestPackDigest, context.ManifestSHA256, context.PublicCasesSHA256, context.PrivateCasesSHA256, context.ManifestBindingDigest} {
		if !hash.MatchString(value) {
			return ErrUnavailable
		}
	}
	if len(context.TestPackID) > 100 || !regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`).MatchString(context.TestPackID) {
		return ErrUnavailable
	}
	seen := map[string]bool{}
	for i, g := range context.Groups {
		if !key.MatchString(g.GroupKey) || !hash.MatchString(g.CriteriaDigest) || seen[g.GroupKey] ||
			report.Groups[i].GroupKey != g.GroupKey || report.Groups[i].CriteriaDigest != g.CriteriaDigest {
			return ErrUnavailable
		}
		seen[g.GroupKey] = true
	}
	return nil
}
func makeBody(context NativeContext, report protocol.FunctionalReport) (body, string, error) {
	raw, err := json.Marshal(struct {
		Version int                       `json:"version"`
		Context NativeContext             `json:"context"`
		Report  protocol.FunctionalReport `json:"report"`
	}{1, context, report})
	if err != nil {
		return body{}, "", ErrUnavailable
	}
	digest, err := protocol.Digest(raw, "01coding-exam-functional-evidence")
	if err != nil {
		return body{}, "", ErrUnavailable
	}
	result := body{State: "evaluated", Evidence: evidence{SubmissionID: report.SubmissionID, QuestionKey: report.ItemKey, AnswerSHA256: report.ArtifactSHA256, RubricDigest: context.RubricDigest,
		PublishedCriteriaDigest: context.PublishedCriteriaDigest, Kind: "groups", EvidenceDigest: digest, Outcomes: report.Groups}}
	raw, err = json.Marshal(result)
	if err != nil {
		return body{}, "", ErrUnavailable
	}
	digest, err = protocol.Digest(raw, "01coding-exam-scoring-event")
	return result, digest, err
}
func operationID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", ErrUnavailable
	}
	bytes[6] = (bytes[6] & 15) | 64
	bytes[8] = (bytes[8] & 63) | 128
	text := hex.EncodeToString(bytes[:])
	return text[:8] + "-" + text[8:12] + "-" + text[12:16] + "-" + text[16:20] + "-" + text[20:], nil
}
func (p *Publisher) Prepare(ctx context.Context, input *protocol.FunctionalReport) (*Prepared, error) {
	if p == nil || input == nil || ctx.Err() != nil || (p.localOnly && !p.localBound) {
		return nil, ErrUnavailable
	}
	var target *localdb.Target
	if p.localOnly {
		if p.localTarget == nil {
			return nil, ErrUnavailable
		}
		captured := *p.localTarget
		target = &captured
	}
	if p.matchesLocalTarget(target) != nil {
		return nil, ErrUnavailable
	}
	capturedCall := p.call
	// Capture caller-owned slices before any context read/await.
	raw, err := json.Marshal(input)
	var report protocol.FunctionalReport
	if err != nil || artifact.Strict(raw, &report) != nil || p.routes[report.EvaluationSpecDigest] == "" {
		return nil, ErrUnavailable
	}
	route := p.routes[report.EvaluationSpecDigest]
	raw, err = capturedCall(ctx, route, ReadContextSQL, report.SubmissionID, report.JobID)
	if err != nil {
		return nil, ErrUnavailable
	}
	var native NativeContext
	if artifact.Strict(raw, &native) != nil || validate(native, report) != nil {
		return nil, ErrUnavailable
	}
	payload, digest, err := makeBody(native, report)
	if err != nil {
		return nil, ErrUnavailable
	}
	operation, err := operationID()
	if err != nil {
		return nil, err
	}
	if p.matchesLocalTarget(target) != nil {
		return nil, ErrUnavailable
	}
	saved := envelope{Version: 1, OperationID: operation, Context: native, Report: report, Body: payload, BodyDigest: digest, LocalTarget: target}
	bytes, err := json.Marshal(saved)
	if err != nil || p.store(operation, bytes) != nil {
		return nil, ErrUnavailable
	}
	return &Prepared{publisher: p, captured: saved, raw: bytes, call: capturedCall, route: route}, nil
}
func (p *Prepared) OperationID() string {
	if p == nil {
		return ""
	}
	return p.captured.OperationID
}
func (p *Prepared) Publish(ctx context.Context) error {
	if p == nil || p.publisher == nil || ctx.Err() != nil || (p.publisher.localOnly && !p.publisher.localBound) {
		return ErrUnavailable
	}
	if p.publisher.matchesLocalTarget(p.captured.LocalTarget) != nil || p.call == nil {
		return ErrUnavailable
	}
	retained, err := p.publisher.read(p.captured.OperationID)
	if err != nil || !bytes.Equal(retained, p.raw) {
		return ErrUnavailable
	}
	captured := p.captured
	payload, _ := json.Marshal(captured.Body)
	raw, err := p.call(ctx, p.route, RecordSQL, captured.OperationID, captured.Report.SubmissionID, captured.Context.ExpectedRevision, string(payload), captured.BodyDigest)
	if err != nil {
		return ErrUnknown
	}
	var response map[string]json.RawMessage
	if artifact.Strict(raw, &response) != nil {
		return ErrUnknown
	}
	var kind string
	if artifact.Strict(response["kind"], &kind) != nil {
		return ErrUnknown
	}
	if len(response) == 1 {
		switch kind {
		case "invalid_input", "forbidden", "unavailable", "conflict", "stale_revision":
			return ErrDenied
		}
	}
	var ack struct {
		Kind          string `json:"kind"`
		EventID       string `json:"eventId"`
		OperationID   string `json:"operationId"`
		SubmissionID  string `json:"submissionId"`
		Revision      string `json:"revision"`
		PayloadDigest string `json:"payloadDigest"`
		Replayed      *bool  `json:"replayed"`
	}
	expected, _ := strconv.ParseInt(captured.Context.ExpectedRevision, 10, 64)
	if artifact.Strict(raw, &ack) != nil || len(response) != 7 || ack.Kind != "recorded" || !uuid.MatchString(ack.EventID) ||
		ack.OperationID != captured.OperationID || ack.SubmissionID != captured.Report.SubmissionID || ack.Revision != fmt.Sprint(expected+1) ||
		ack.PayloadDigest != captured.BodyDigest || ack.Replayed == nil {
		return ErrUnknown
	}
	return nil
}

// Replay reads the retained envelope and sends the ORIGINAL operation, expected
// revision and bytes. It performs no fresh context read, new operation or delete.
func (p *Publisher) Replay(ctx context.Context, operation string) error {
	if p == nil || !uuid.MatchString(operation) || (p.localOnly && !p.localBound) {
		return ErrUnavailable
	}
	raw, err := p.read(operation)
	if err != nil {
		return ErrUnavailable
	}
	var saved envelope
	if artifact.Strict(raw, &saved) != nil || saved.Version != 1 || saved.OperationID != operation ||
		p.routes[saved.Context.EvaluatorDigest] == "" || validate(saved.Context, saved.Report) != nil {
		return ErrUnavailable
	}
	if p.matchesLocalTarget(saved.LocalTarget) != nil {
		return ErrUnavailable
	}
	expected, digest, err := makeBody(saved.Context, saved.Report)
	actual, _ := json.Marshal(saved.Body)
	canonical, _ := json.Marshal(expected)
	if err != nil || digest != saved.BodyDigest || !bytes.Equal(actual, canonical) {
		return ErrUnavailable
	}
	prepared := &Prepared{publisher: p, captured: saved, raw: raw, call: p.call, route: p.routes[saved.Context.EvaluatorDigest]}
	return prepared.Publish(ctx)
}
