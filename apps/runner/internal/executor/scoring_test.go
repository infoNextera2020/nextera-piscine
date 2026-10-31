package executor

import (
	"context"
	"encoding/json"
	"errors"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/protocol"
	"nextera.local/runner/internal/sandbox"
	"reflect"
	"strings"
	"testing"
	"time"
)

func scoredFiles(t *testing.T) map[string][]byte {
	public := []byte(`[{"input":{"a":1,"b":2},"expected":3},{"input":{"a":4,"b":2},"expected":6}]`)
	private := []byte(`[{"input":{"a":-1,"b":2},"expected":1}]`)
	var a, b []json.RawMessage
	_ = json.Unmarshal(public, &a)
	_ = json.Unmarshal(private, &b)
	group := func(name, digest string, indices []int, rows []json.RawMessage) map[string]any {
		refs := []any{}
		for i, index := range indices {
			refs = append(refs, map[string]any{"index": index, "caseSha256": artifact.BytesDigest(rows[i])})
		}
		return map[string]any{"groupKey": name, "criteriaDigest": strings.Repeat(digest, 64), "cases": refs}
	}
	wire := map[string]any{"version": 1, "failureSemantics": artifact.CompleteObservationsOnly, "caseFiles": map[string]any{"publicSha256": artifact.BytesDigest(public), "privateSha256": artifact.BytesDigest(private)},
		"groups": []any{group("basic", "a", []int{0, 1}, a), group("edge", "b", []int{2}, b)}}
	manifest, _ := json.Marshal(wire)
	return map[string][]byte{"cases/public.json": public, "cases/private.json": private, artifact.ScoringManifestPath: manifest}
}

type scoringPhase struct {
	*fakeProgramPhase
	execution  bool
	calls      int
	budgets    []time.Time
	outputCaps []int
	input      []byte
}

func (p *scoringPhase) Exec(ctx context.Context, command, env []string, input []byte, limit int) ([]byte, []byte, int, error) {
	if p.execution && len(command) > 0 && command[0] == "/bin/sh" {
		p.calls++
		deadline, _ := ctx.Deadline()
		p.budgets = append(p.budgets, deadline)
		p.outputCaps = append(p.outputCaps, limit)
		p.input = append([]byte(nil), input...)
	}
	return p.fakeProgramPhase.Exec(ctx, command, env, input, limit)
}

type scoringEngine struct {
	compilation, execution *scoringPhase
	creates                int
}

func (e *scoringEngine) VerifyImage(context.Context, string) error { return nil }
func (e *scoringEngine) Create(_ context.Context, _ string, compilation bool) (gradingPhase, error) {
	e.creates++
	if compilation {
		return e.compilation, nil
	}
	return e.execution, nil
}
func scoredSnapshot() protocol.Snapshot {
	s := functionSnapshot("int_int", "int")
	s.Contract.Item = "q1"
	s.PackID = "exam-q1"
	s.Digest = strings.Repeat("c", 64)
	s.Submission = "11111111-1111-1111-1111-111111111111"
	s.VerifiedJob = "22222222-2222-2222-2222-222222222222"
	s.VerifiedDigest = strings.Repeat("d", 64)
	s.SpecDigest = strings.Repeat("e", 64)
	s.Source.Digest = strings.Repeat("f", 64)
	return s
}
func TestScoringCompleteHostPipelineRetainsPartialGroupsInOneBudget(t *testing.T) {
	source := []byte("package piscine\nfunc Fixture(a,b int) int{return a+b}\n") // trusted test bytes, never executed
	for _, row := range []struct {
		name, output, verdict string
		groups                []bool
	}{
		{"correct", `[{"return":3},{"return":6},{"return":1}]`, "passed", []bool{true, true}},
		{"ordinary-wrong", `[{"return":0},{"return":0},{"return":0}]`, "failed", []bool{false, false}},
		{"partial", `[{"return":3},{"return":0},{"return":1}]`, "failed", []bool{false, true}},
	} {
		t.Run(row.name, func(t *testing.T) {
			engine := &scoringEngine{compilation: &scoringPhase{fakeProgramPhase: &fakeProgramPhase{}},
				execution: &scoringPhase{fakeProgramPhase: &fakeProgramPhase{build: programResponse{out: []byte(row.output)}}, execution: true}}
			s := scoredSnapshot()
			before := time.Now()
			result := (Executor{engine: engine}).evaluateLoaded(context.Background(), s, source, scoredFiles(t), *s.Contract)
			if result.Verdict != row.verdict || result.Functional == nil || result.FunctionalUnavailable != "" {
				t.Fatal("complete pipeline lost group evidence", result)
			}
			got := []bool{result.Functional.Groups[0].Passed, result.Functional.Groups[1].Passed}
			if !reflect.DeepEqual(got, row.groups) || engine.creates != 2 || engine.execution.calls != 1 || engine.compilation.closed != 1 || engine.execution.closed != 1 {
				t.Fatal("wrong groups, repeated phases, or missing teardown", got, engine.creates)
			}
			if engine.execution.outputCaps[0] != s.Resources.Execution.Output || engine.execution.budgets[0].Before(before) || engine.execution.budgets[0].After(before.Add(time.Duration(s.Resources.Execution.Timeout)*time.Millisecond+time.Second)) {
				t.Fatal("execution resource budget multiplied")
			}
			if strings.Contains(string(engine.execution.input), "expected") || strings.Contains(string(engine.execution.input), "group") {
				t.Fatal("oracle metadata entered adapter input")
			}
			for _, bytes := range engine.compilation.files {
				if strings.Contains(string(bytes), "criteriaDigest") || strings.Contains(string(bytes), "private.json") {
					t.Fatal("private manifest entered compilation")
				}
			}
		})
	}
}
func TestScoringIncompleteExecutionNeverManufacturesGroupFailures(t *testing.T) {
	for _, row := range []struct {
		name     string
		response programResponse
		stop     error
	}{
		{"partial-vector", programResponse{out: []byte(`[{"return":3}]`)}, nil},
		{"bad-final-observation", programResponse{out: []byte(`[{"return":3},{"return":6},{"passed":true}]`)}, nil},
		{"timeout", programResponse{err: context.DeadlineExceeded}, nil},
		{"learner-runtime", programResponse{exit: 2}, nil},
		{"output-overflow", programResponse{err: sandbox.ErrOutput}, nil},
		{"infrastructure", programResponse{err: sandbox.ErrInfrastructure}, nil},
		{"unproved-stop", programResponse{out: []byte(`[{"return":3},{"return":6},{"return":1}]`)}, errors.New("stop unproved")},
	} {
		t.Run(row.name, func(t *testing.T) {
			s := scoredSnapshot()
			engine := &scoringEngine{compilation: &scoringPhase{fakeProgramPhase: &fakeProgramPhase{}},
				execution: &scoringPhase{fakeProgramPhase: &fakeProgramPhase{build: row.response, stopErr: row.stop}, execution: true}}
			result := (Executor{engine: engine}).evaluateLoaded(context.Background(), s, []byte("package piscine\nfunc Fixture(a,b int)int{return a+b}\n"), scoredFiles(t), *s.Contract)
			if result.Functional != nil {
				t.Fatal("unobserved data became zero/passed groups", result)
			}
		})
	}
	s := scoredSnapshot()
	files := scoredFiles(t)
	delete(files, artifact.ScoringManifestPath)
	e := &scoringEngine{compilation: &scoringPhase{fakeProgramPhase: &fakeProgramPhase{}}, execution: &scoringPhase{fakeProgramPhase: &fakeProgramPhase{build: programResponse{out: []byte(`[{"return":3},{"return":6},{"return":1}]`)}}, execution: true}}
	if result := (Executor{engine: e}).evaluateLoaded(context.Background(), s, []byte("package piscine\nfunc Fixture(a,b int)int{return a+b}\n"), files, *s.Contract); result.Functional != nil || result.Verdict != "passed" {
		t.Fatal("missing manifest changed binary verdict or inferred groups", result)
	}
}
func TestScoringCompilerCausePreservesBinaryVerdictWithoutInventedPoints(t *testing.T) {
	for _, row := range []struct {
		name     string
		response programResponse
		cause    string
	}{
		{"rejected", programResponse{exit: 1}, "observed_compiler_nonzero"},
		{"budget", programResponse{err: context.DeadlineExceeded}, "compilation_unobserved"},
		{"output", programResponse{err: sandbox.ErrOutput}, "compilation_unobserved"},
	} {
		t.Run(row.name, func(t *testing.T) {
			s := scoredSnapshot()
			e := &scoringEngine{compilation: &scoringPhase{fakeProgramPhase: &fakeProgramPhase{build: row.response}}, execution: &scoringPhase{fakeProgramPhase: &fakeProgramPhase{}, execution: true}}
			result := (Executor{engine: e}).evaluateLoaded(context.Background(), s, []byte("package piscine\nfunc Fixture(a,b int)int{return a+b}\n"), scoredFiles(t), *s.Contract)
			if result.Verdict != "compile_error" || result.Functional != nil || result.FunctionalUnavailable != row.cause || e.creates != 1 {
				t.Fatal("compiler cause conflated or graded without observations", result, e.creates)
			}
		})
	}
}
