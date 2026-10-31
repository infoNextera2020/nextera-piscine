package atm

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/protocol"
	"regexp"
	"strconv"
)

var ErrUnavailable = errors.New("ATM_EVIDENCE_UNAVAILABLE")
var ErrUnknown = errors.New("ATM_RETENTION_UNKNOWN")
var uuid = regexp.MustCompile(`^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)
var hash = regexp.MustCompile(`^[0-9a-f]{64}$`)

type ResolveRequest struct {
	Version                  int    `json:"version"`
	JobID                    string `json:"jobId"`
	JudgeAttemptID           string `json:"judgeAttemptId"`
	WorkerID                 string `json:"workerId"`
	Generation               string `json:"generation"`
	SubmissionID             string `json:"submissionId"`
	EvaluationSnapshotDigest string `json:"evaluationSnapshotDigest"`
}
type Context struct {
	Version                  int    `json:"version"`
	JobID                    string `json:"jobId"`
	JudgeAttemptID           string `json:"judgeAttemptId"`
	WorkerID                 string `json:"workerId"`
	Generation               string `json:"generation"`
	SubmissionID             string `json:"submissionId"`
	RaidAttemptID            string `json:"raidAttemptId"`
	TeamID                   string `json:"teamId"`
	CohortID                 string `json:"cohortId"`
	CurriculumVersionID      string `json:"curriculumVersionId"`
	NodeKey                  string `json:"nodeKey"`
	SourceSHA256             string `json:"sourceSha256"`
	EvaluationSnapshotDigest string `json:"evaluationSnapshotDigest"`
	EvaluationSpecDigest     string `json:"evaluationSpecDigest"`
	DefinitionDigest         string `json:"definitionDigest"`
	TestPackID               string `json:"testPackId"`
	TestPackDigest           string `json:"testPackDigest"`
	SemanticProfileDigest    string `json:"semanticProfileDigest"`
	RunnerImageDigest        string `json:"runnerImageDigest"`
	ResourcePolicyDigest     string `json:"resourcePolicyDigest"`
	ModelID                  string `json:"modelId"`
	CaseCount                int    `json:"caseCount"`
	ContextDigest            string `json:"contextDigest"`
}

func SHA(data []byte) string { v := sha256.Sum256(data); return hex.EncodeToString(v[:]) }
func Canonical(v any) ([]byte, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, ErrUnavailable
	}
	var obj any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if d.Decode(&obj) != nil {
		return nil, ErrUnavailable
	}
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if e.Encode(obj) != nil {
		return nil, ErrUnavailable
	}
	return bytes.TrimSuffix(b.Bytes(), []byte{'\n'}), nil
}
func Framed(domain string, v any) (string, error) {
	b, err := Canonical(v)
	if err != nil {
		return "", err
	}
	return SHA(append([]byte(domain+"\x00v1\x00"), b...)), nil
}
func ResourceDigest(environment artifact.Environment) (string, error) {
	if !environment.Valid() {
		return "", ErrUnavailable
	}
	return Framed("nextera-atm-resource-policy", environment)
}
func (c Context) Digest() (string, error) {
	raw, _ := json.Marshal(c)
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return "", ErrUnavailable
	}
	delete(m, "contextDigest")
	return Framed("nextera-atm-capture-context", m)
}
func Request(cl protocol.Claim, s protocol.Snapshot) (ResolveRequest, error) {
	if !uuid.MatchString(cl.Job) || !uuid.MatchString(cl.Attempt) || !uuid.MatchString(cl.Worker) || !uuid.MatchString(cl.Token) || cl.Generation < 1 || s.VerifiedJob != cl.Job || s.VerifiedDigest != cl.Digest || s.VerifiedJudgeAttempt != cl.Attempt || s.VerifiedWorker != cl.Worker || s.VerifiedGeneration != cl.Generation {
		return ResolveRequest{}, ErrUnavailable
	}
	return ResolveRequest{1, cl.Job, cl.Attempt, cl.Worker, strconv.FormatInt(cl.Generation, 10), s.Submission, s.VerifiedDigest}, nil
}
func (c Context) Bound(s protocol.Snapshot) bool {
	contract, err := artifact.ContractFor(s.PackID, s.Contract)
	resource, resourceErr := ResourceDigest(s.Environment)
	digest, digestErr := c.Digest()
	if err != nil || contract.Version != 4 || !artifact.ValidSemanticProfile(contract, s.SemanticProfileDigest) || resourceErr != nil || digestErr != nil || digest != c.ContextDigest {
		return false
	}
	for _, v := range []string{c.JobID, c.JudgeAttemptID, c.WorkerID, c.SubmissionID, c.RaidAttemptID, c.TeamID, c.CohortID, c.CurriculumVersionID} {
		if !uuid.MatchString(v) {
			return false
		}
	}
	for _, v := range []string{c.SourceSHA256, c.EvaluationSnapshotDigest, c.EvaluationSpecDigest, c.DefinitionDigest, c.TestPackDigest, c.ResourcePolicyDigest, c.ContextDigest} {
		if !hash.MatchString(v) {
			return false
		}
	}
	return c.Version == 1 && c.CaseCount > 0 && c.ModelID == ModelID && c.SemanticProfileDigest == SemanticProfileDigest && c.JobID == s.VerifiedJob && c.JudgeAttemptID == s.VerifiedJudgeAttempt && c.WorkerID == s.VerifiedWorker && c.Generation == strconv.FormatInt(s.VerifiedGeneration, 10) && s.VerifiedGeneration > 0 && c.SubmissionID == s.Submission && c.CohortID == s.Cohort && c.CurriculumVersionID == s.CurriculumID && c.NodeKey == s.Node && c.SourceSHA256 == s.Source.Digest && c.EvaluationSnapshotDigest == s.VerifiedDigest && c.EvaluationSpecDigest == s.SpecDigest && c.TestPackID == s.PackID && c.TestPackDigest == s.Digest && c.RunnerImageDigest == s.Runner && c.ResourcePolicyDigest == resource
}

type Capture struct {
	CaseFile               string `json:"caseFile"`
	CaseIndex              int    `json:"caseIndex"`
	InputSHA256            string `json:"inputSha256"`
	StdinBase64            string `json:"stdinBase64"`
	StdoutBase64           string `json:"stdoutBase64"`
	StderrBase64           string `json:"stderrBase64"`
	ExitCode               *int   `json:"exitCode"`
	TransportWriteComplete bool   `json:"transportWriteComplete"`
	StdinHalfClosed        bool   `json:"stdinHalfClosed"`
	OutputComplete         bool   `json:"outputComplete"`
	Termination            string `json:"termination"`
	Assessment             string `json:"assessment"`
}

// Evidence never enters queue JSON. StopVerified is host-only and is set only
// after the independent owned-container absence check succeeds.
type Evidence struct {
	Context      Context
	Captures     []Capture
	StopVerified bool
}

func (e Evidence) Clone() Evidence {
	v := e
	v.Captures = append([]Capture{}, e.Captures...)
	for i := range v.Captures {
		if e.Captures[i].ExitCode != nil {
			n := *e.Captures[i].ExitCode
			v.Captures[i].ExitCode = &n
		}
	}
	return v
}
func (e Evidence) CompleteMatch() bool {
	if !e.StopVerified || len(e.Captures) != e.Context.CaseCount {
		return false
	}
	for _, c := range e.Captures {
		if c.Assessment != "observations_match" || !c.TransportWriteComplete || !c.StdinHalfClosed || !c.OutputComplete || c.Termination != "exited" || c.ExitCode == nil || *c.ExitCode != 0 {
			return false
		}
	}
	return true
}

type Envelope struct {
	Version       int       `json:"version"`
	OperationID   string    `json:"operationId"`
	Context       Context   `json:"context"`
	CaptureDigest string    `json:"captureDigest"`
	Captures      []Capture `json:"captures"`
}

func CaptureDigest(context Context, captures []Capture) (string, error) {
	return Framed("nextera-atm-capture", struct {
		Version  int       `json:"version"`
		Context  Context   `json:"context"`
		Captures []Capture `json:"captures"`
	}{1, context, captures})
}

type Ack struct {
	Version       int    `json:"version"`
	OperationID   string `json:"operationId"`
	ContextDigest string `json:"contextDigest"`
	CaptureDigest string `json:"captureDigest"`
	State         string `json:"state"`
}
