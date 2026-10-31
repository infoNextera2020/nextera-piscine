package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/protocol"
	"nextera.local/runner/internal/sandbox"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"
)

// The restricted profile applies to the entire learner input, not just the
// exported function body. Exact single-file inventory prevents helper-file,
// import-alias and directive bypasses before a compiler phase can be created.
func validateFunctionSources(c artifact.ExecutionContract, files map[string][]byte) error {
	source, ok := files[c.File]
	if !ok || len(files) != 1 {
		return errProgramSource
	}
	parsed, err := parser.ParseFile(token.NewFileSet(), c.File, source, parser.ParseComments|parser.AllErrors)
	if err != nil || parsed == nil || parsed.Name == nil || parsed.Name.Name != "piscine" || len(parsed.Imports) != 0 {
		return errProgramSource
	}
	for _, group := range parsed.Comments {
		for _, comment := range group.List {
			body := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(comment.Text, "//"), "/*"))
			if strings.HasPrefix(body, "go:") || strings.HasPrefix(body, "+build") ||
				body == "line" || strings.HasPrefix(body, "line ") || strings.HasPrefix(body, "line\t") ||
				body == "export" || strings.HasPrefix(body, "export ") || strings.HasPrefix(body, "export\t") {
				return errProgramSource
			}
		}
	}
	for _, declaration := range parsed.Decls {
		switch d := declaration.(type) {
		case *ast.GenDecl:
			if d.Tok == token.IMPORT || d.Tok == token.VAR {
				return errProgramSource
			}
		case *ast.FuncDecl:
			if d.Name.Name == "init" {
				return errProgramSource
			}
		}
	}
	valid := true
	ast.Inspect(parsed, func(node ast.Node) bool {
		if _, ok := node.(*ast.GoStmt); ok {
			valid = false
		}
		return valid
	})
	if !valid {
		return errProgramSource
	}
	return nil
}

// ABI3 admits exactly the five public function signatures in ContractFor.
// Expected integers and the slice-preservation comparison stay on this host.
func functionInt(raw json.RawMessage) (int64, error) {
	var v int64
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || artifact.Strict(raw, &v) != nil {
		return 0, artifact.ErrInvalid
	}
	return v, nil
}

func functionFields(raw json.RawMessage, keys ...string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if artifact.Strict(raw, &fields) != nil || len(fields) != len(keys) {
		return nil, artifact.ErrInvalid
	}
	for _, key := range keys {
		if _, ok := fields[key]; !ok {
			return nil, artifact.ErrInvalid
		}
	}
	return fields, nil
}

func functionSlice(raw json.RawMessage) ([]int64, error) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var rows []json.RawMessage
	if artifact.Strict(raw, &rows) != nil || rows == nil {
		return nil, artifact.ErrInvalid
	}
	values := make([]int64, len(rows))
	for i, row := range rows {
		value, err := functionInt(row)
		if err != nil {
			return nil, err
		}
		values[i] = value
	}
	return values, nil
}

func functionInput(c artifact.ExecutionContract, raw json.RawMessage) ([]int64, error) {
	if !utf8.Valid(raw) {
		return nil, artifact.ErrInvalid
	}
	var keys []string
	switch c.Input {
	case "string":
		var value string
		if len(raw) < 2 || raw[0] != '"' || artifact.Strict(raw, &value) != nil {
			return nil, artifact.ErrInvalid
		}
		return nil, nil
	case "int_slice":
		return functionSlice(raw)
	case "int_int":
		keys = []string{"a", "b"}
	case "pointer_int_int":
		keys = []string{"pointer", "value"}
	case "int_slice_int_int":
		keys = []string{"slice", "a", "b"}
	default:
		return nil, artifact.ErrInvalid
	}
	fields, err := functionFields(raw, keys...)
	if err != nil {
		return nil, err
	}
	var original []int64
	for _, key := range keys {
		if key == "slice" {
			original, err = functionSlice(fields[key])
		} else {
			_, err = functionInt(fields[key])
		}
		if err != nil {
			return nil, err
		}
	}
	return original, nil
}

func functionCases(files map[string][]byte, c artifact.ExecutionContract) ([]json.RawMessage, []string, error) {
	var inputs []json.RawMessage
	var expected []string
	for _, name := range []string{"cases/public.json", "cases/private.json"} {
		var rows []struct {
			Input    json.RawMessage `json:"input"`
			Expected json.RawMessage `json:"expected"`
		}
		if !utf8.Valid(files[name]) || artifact.Strict(files[name], &rows) != nil || len(rows) == 0 || len(rows) > 10000 {
			return nil, nil, artifact.ErrInvalid
		}
		for _, row := range rows {
			if _, err := functionInput(c, row.Input); err != nil {
				return nil, nil, err
			}
			if _, err := functionInt(row.Expected); err != nil {
				return nil, nil, err
			}
			inputs = append(inputs, row.Input)
			expected = append(expected, string(row.Expected))
		}
	}
	return inputs, expected, nil
}

// Public transport only: no private cases, expected values or comparison logic.
// Descriptor 3 is connected by the trusted launcher; ordinary stdout and stderr
// are captured separately and rejected, including output from package init.
func functionAdapter(c artifact.ExecutionContract) []byte {
	var typ, signature, call string
	switch c.Input {
	case "int_int":
		signature = "func(int,int) int"
		typ = `struct{A int ` + "`json:\"a\"`" + `;B int ` + "`json:\"b\"`" + `}`
		call = `outputs=append(outputs,map[string]any{"return":invoke(v.A,v.B)})`
	case "pointer_int_int":
		signature = "func(*int,int)"
		typ = `struct{Pointer int ` + "`json:\"pointer\"`" + `;Value int ` + "`json:\"value\"`" + `}`
		call = `invoke(&v.Pointer,v.Value);outputs=append(outputs,map[string]any{"pointer":v.Pointer})`
	case "int_slice_int_int":
		signature = "func([]int,int,int) int"
		typ = `struct{Slice []int ` + "`json:\"slice\"`" + `;A int ` + "`json:\"a\"`" + `;B int ` + "`json:\"b\"`" + `}`
		call = `result:=invoke(v.Slice,v.A,v.B);post:=snapshot(v.Slice);outputs=append(outputs,map[string]any{"return":result,"slice":post})`
	case "string", "int_slice":
		signature = "func(string) int"
		typ = "string"
		call = `outputs=append(outputs,map[string]any{"return":invoke(v)})`
		if c.Input == "int_slice" {
			signature = "func([]int) int"
			typ = "[]int"
			call = `result:=invoke(v);post:=snapshot(v);outputs=append(outputs,map[string]any{"return":result,"slice":post})`
		}
	default:
		return nil
	}
	return []byte(`package main
import("encoding/json";"os";"nextera.local/learner/piscine")
var invoke ` + signature + ` = piscine.` + c.Function + `
func snapshot(v []int) []int {if v==nil{return nil};post:=make([]int,len(v));copy(post,v);return post}
func main(){var inputs []` + typ + `;if json.NewDecoder(os.Stdin).Decode(&inputs)!=nil{os.Exit(2)};outputs:=make([]map[string]any,0,len(inputs));for _,v:=range inputs{` + call + `};wire:=os.NewFile(3,"function-results");if wire==nil||json.NewEncoder(wire).Encode(outputs)!=nil{os.Exit(2)}}
`)
}

func compareFunction(c artifact.ExecutionContract, inputs []json.RawMessage, expected []string, out []byte) string {
	verdict, _ := compareFunctionObservations(c, inputs, expected, out)
	return verdict
}

func compareFunctionObservations(c artifact.ExecutionContract, inputs []json.RawMessage, expected []string, out []byte) (string, []bool) {
	if len(inputs) != len(expected) {
		return "runtime_error", nil
	}
	var rows []json.RawMessage
	if !utf8.Valid(out) || artifact.Strict(out, &rows) != nil || len(rows) != len(inputs) {
		return "runtime_error", nil
	}
	passed := true
	observations := make([]bool, 0, len(inputs))
	for i, row := range rows {
		keys := []string{"return"}
		if c.Output == "pointer_int" {
			keys = []string{"pointer"}
		} else if c.Output == "int_slice_preserved" {
			keys = append(keys, "slice")
		}
		fields, err := functionFields(row, keys...)
		if err != nil {
			return "runtime_error", nil
		}
		actual, err := functionInt(fields[keys[0]])
		if err != nil {
			return "runtime_error", nil
		}
		want, err := functionInt(json.RawMessage(expected[i]))
		if err != nil {
			return "runtime_error", nil
		}
		matched := actual == want
		if c.Output == "int_slice_preserved" {
			original, _ := functionInput(c, inputs[i])
			post, err := functionSlice(fields["slice"])
			if err != nil {
				return "runtime_error", nil
			}
			matched = matched && reflect.DeepEqual(original, post)
		}
		observations = append(observations, matched)
		passed = passed && matched
	}
	if !passed {
		return "failed", observations
	}
	return "passed", observations
}

func (e Executor) executeFunction(ctx context.Context, s protocol.Snapshot, program []byte, inputs []json.RawMessage, expected []string, metrics map[string]int64) (string, error) {
	verdict, _, err := e.executeFunctionObserved(ctx, s, program, inputs, expected, metrics)
	return verdict, err
}

func (e Executor) executeFunctionObserved(ctx context.Context, s protocol.Snapshot, program []byte, inputs []json.RawMessage, expected []string, metrics map[string]int64) (verdict string, observations []bool, err error) {
	c, err := artifact.ContractFor(s.PackID, s.Contract)
	if err != nil || c.Version != 3 || !s.Environment.Valid() || len(inputs) == 0 || len(inputs) != len(expected) {
		return "", nil, artifact.ErrInvalid
	}
	for i, input := range inputs {
		if _, err := functionInput(c, input); err != nil {
			return "", nil, err
		}
		if _, err := functionInt(json.RawMessage(expected[i])); err != nil {
			return "", nil, err
		}
	}
	if ctx.Err() != nil {
		return "", nil, ctx.Err()
	}
	p, err := e.runtimeEngine().Create(ctx, s.Sandbox, false)
	if err != nil {
		return "", nil, err
	}
	defer func() {
		if stopGradingPhase(p) != nil {
			verdict, observations, err = "", nil, sandbox.ErrInfrastructure
		}
	}()
	if p.Import(ctx, map[string][]byte{"program": program}) != nil {
		return "", nil, sandbox.ErrInfrastructure
	}
	if _, _, exit, err := p.Exec(ctx, []string{"/bin/chmod", "500", "/workspace/program"}, nil, nil, 65536); err != nil || exit != 0 {
		return "", nil, sandbox.ErrInfrastructure
	}
	input, _ := json.Marshal(inputs)
	phase, cancel := context.WithTimeout(ctx, time.Duration(s.Resources.Execution.Timeout)*time.Millisecond)
	defer cancel()
	started := time.Now()
	out, stderr, exit, execErr := p.Exec(phase, []string{"/bin/sh", "-c", "exec /workspace/program 3>&1 1>&2"}, nil, input, s.Resources.Execution.Output)
	metrics["execution_ms"] = time.Since(started).Milliseconds()
	if ctx.Err() != nil {
		return "", nil, ctx.Err()
	}
	if errors.Is(execErr, context.DeadlineExceeded) || errors.Is(phase.Err(), context.DeadlineExceeded) {
		return "timeout", nil, nil
	}
	if errors.Is(execErr, sandbox.ErrOutput) {
		return "runtime_error", nil, nil
	}
	if execErr != nil {
		return "", nil, sandbox.ErrInfrastructure
	}
	if exit != 0 || len(stderr) != 0 {
		return "runtime_error", nil, nil
	}
	if resourceErr := programResources(phase, p); resourceErr != nil {
		if ctx.Err() != nil {
			return "", nil, ctx.Err()
		}
		if errors.Is(phase.Err(), context.DeadlineExceeded) {
			return "timeout", nil, nil
		}
		if errors.Is(resourceErr, errProgramResources) {
			return "runtime_error", nil, nil
		}
		return "", nil, sandbox.ErrInfrastructure
	}
	verdict, observations = compareFunctionObservations(c, inputs, expected, out)
	return verdict, observations, nil
}
