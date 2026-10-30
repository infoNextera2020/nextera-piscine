package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/protocol"
	"nextera.local/runner/internal/sandbox"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func functionSnapshot(input, output string) protocol.Snapshot {
	s := programSnapshot()
	s.PackID = "trusted-fixture-v3"
	s.Contract = &artifact.ExecutionContract{Version: 3, Item: "trusted-fixture", File: "original-fixture.go", Function: "Fixture", Input: input, Output: output}
	return s
}

func TestFunctionStagingKeepsOriginalSourceFlatAndPrivate(t *testing.T) {
	s := functionSnapshot("int_int", "int")
	source := []byte("// trusted byte fixture\r\npackage piscine\r\nfunc Fixture(a,b int) int{return a+b}\r\n")
	files, command, err := compilationPlan(s, source)
	if err != nil || len(files) != 3 || !bytes.Equal(files[s.Contract.File], source) || string(files["go.mod"]) != "module nextera.local/learner\n\ngo 1.27.2\n" {
		t.Fatal("original source bytes or fixed module changed", err)
	}
	if _, err := sandbox.Archive(files); err != nil {
		t.Fatal("function plan requires relaxed archive", err)
	}
	if len(command) != 3 || !strings.Contains(command[2], "mkdir /workspace/piscine /workspace/cmd") || !strings.Contains(command[2], "/workspace/piscine/"+s.Contract.File) || !strings.HasSuffix(command[2], " ./cmd") || !strings.Contains(command[2], "GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOWORK=off") {
		t.Fatal("staging is not fixed offline package build", command)
	}
	for name, data := range files {
		if strings.ContainsAny(name, "/\\") || strings.Contains(string(data), "expected") || strings.Contains(string(data), "private.json") || strings.Contains(string(data), "bridge.go") {
			t.Fatal("oracle, nested path or expected value entered compiler import")
		}
	}
	for _, source := range []string{"package main\n", "package other\n", "not Go"} {
		engine := &fakeProgramEngine{phase: &fakeProgramPhase{}}
		_, verdict, err := (Executor{engine: engine}).compile(context.Background(), s, []byte(source), map[string]int64{})
		if err != nil || verdict != "compile_error" || engine.creates != 0 {
			t.Fatal("wrong learner package touched engine", verdict, err)
		}
	}
}

func TestRestrictedFunctionValidatesWholeSourceBeforeCompilerCreation(t *testing.T) {
	s := functionSnapshot("int_int", "int")
	for _, source := range []string{
		"package piscine\nimport \"os\"\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\nimport _ \"os\"\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\nimport . \"os\"\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\nimport \"C\"\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\nfunc init(){}\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\nvar state int\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\nvar (_ = 1; state = 2)\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\nfunc helper(){go func(){}()}\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\ntype T int\nfunc(T) helper(){go func(){}()}\nfunc Fixture(a,b int)int{return a+b}\n",
		"//go:build ignore\n\npackage piscine\nfunc Fixture(a,b int)int{return a+b}\n",
		"// +build ignore\n\npackage piscine\nfunc Fixture(a,b int)int{return a+b}\n",
		"//line hidden.go:1\npackage piscine\nfunc Fixture(a,b int)int{return a+b}\n",
		"/*line hidden.go:1*/package piscine\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\n//go:linkname write syscall.Write\nfunc helper()\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\n//go:noinline\nfunc helper(){}\nfunc Fixture(a,b int)int{return a+b}\n",
		"package piscine\n//export helper\nfunc helper(){}\nfunc Fixture(a,b int)int{return a+b}\n",
	} {
		engine := &fakeProgramEngine{phase: &fakeProgramPhase{}}
		_, verdict, err := (Executor{engine: engine}).compile(context.Background(), s, []byte(source), map[string]int64{})
		if err != nil || verdict != "compile_error" || engine.creates != 0 {
			t.Fatal("restricted source reached compiler phase", verdict, err, source)
		}
	}
	valid := []byte("package piscine\nconst factor=2\ntype number=int\nfunc helper(v number)int{return v*factor}\nfunc Fixture(a,b int)int{var total int;for i:=0;i<a;i++{total+=helper(b)};return total}\n")
	if err := validateFunctionSources(*s.Contract, map[string][]byte{s.Contract.File: valid}); err != nil {
		t.Fatal("permitted helpers/locals/loops rejected", err)
	}
	for _, files := range []map[string][]byte{
		{},
		{"renamed.go": valid},
		{s.Contract.File: valid, "helper.go": []byte("package piscine\n")},
		{s.Contract.File: valid, "helper.go": []byte("package piscine\nimport _ \"os\"\n")},
		{s.Contract.File: valid, "nested/helper.go": []byte("package piscine\n")},
	} {
		if err := validateFunctionSources(*s.Contract, files); !errors.Is(err, errProgramSource) {
			t.Fatal("extra or renamed learner file accepted", err)
		}
	}
}

// Every executable below is a constant transport fixture owned by this test.
// No submission source, private/reference pack or sandbox is launched.
func TestFunctionTransportWithTrustedFixturesOnly(t *testing.T) {
	for _, row := range []struct{ input, output, source, arguments, result string }{
		{"int_int", "int", "func Fixture(a,b int) int{return a*10+b}", `[{"a":2,"b":3}]`, `[{"return":23}]`},
		{"pointer_int_int", "pointer_int", "func Fixture(p *int,v int){*p=v}", `[{"pointer":9,"value":4}]`, `[{"pointer":4}]`},
		{"int_slice_int_int", "int_slice_preserved", "func Fixture(v []int,a,b int) int{return len(v)+a+b}", `[{"slice":[7,8],"a":3,"b":4}]`, `[{"return":9,"slice":[7,8]}]`},
		{"string", "int", "func Fixture(s string) int{return len(s)}", `["abc"]`, `[{"return":3}]`},
		{"int_slice", "int_slice_preserved", "func Fixture(v []int) int{return len(v)}", `[[1,2],[],null]`, `[{"return":2,"slice":[1,2]},{"return":0,"slice":[]},{"return":0,"slice":null}]`},
	} {
		t.Run(row.input, func(t *testing.T) {
			dir := t.TempDir()
			s := functionSnapshot(row.input, row.output)
			files, _, err := compilationPlan(s, []byte("package piscine\r\n"+row.source+"\r\n"))
			if err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"piscine", "cmd"} {
				if err := os.Mkdir(filepath.Join(dir, name), 0700); err != nil {
					t.Fatal(err)
				}
			}
			for name, data := range map[string][]byte{"go.mod": files["go.mod"], "piscine/" + s.Contract.File: files[s.Contract.File], "cmd/main.go": files["function-transport"]} {
				if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			build := exec.Command(filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid=", "-o", filepath.Join(dir, "program"), "./cmd")
			build.Dir = dir
			build.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOPROXY=off", "GOSUMDB=off", "GOWORK=off", "CGO_ENABLED=0")
			if output, err := build.CombinedOutput(); err != nil {
				t.Fatalf("trusted fixture build: %v: %s", err, output)
			}
			run := exec.Command("/bin/sh", "-c", "exec ./program 3>&1 1>&2")
			run.Dir = dir
			run.Stdin = strings.NewReader(row.arguments)
			var stdout, stderr bytes.Buffer
			run.Stdout = &stdout
			run.Stderr = &stderr
			if err := run.Run(); err != nil || stderr.Len() != 0 {
				t.Fatal("trusted fixture execution", err, stderr.String())
			}
			var got, want any
			if json.Unmarshal(stdout.Bytes(), &got) != nil || json.Unmarshal([]byte(row.result), &want) != nil || !reflect.DeepEqual(got, want) {
				t.Fatal("typed transport", stdout.String())
			}
			if row.input == "int_slice" {
				// Exercise the trusted snapshot helper independently of any learner
				// retention strategy, which the source restriction already rejects.
				check := []byte("package main\nimport \"testing\"\nfunc TestTrustedSnapshot(t *testing.T){v:=[]int{1,2};post:=snapshot(v);v[0]=9;if post[0]!=1{t.Fatal(\"poststate changed after observation\")};if snapshot(nil)!=nil{t.Fatal(\"nil changed\")};empty:=snapshot([]int{});if empty==nil||len(empty)!=0{t.Fatal(\"empty changed\")}}\n")
				if err := os.WriteFile(filepath.Join(dir, "cmd", "snapshot_test.go"), check, 0600); err != nil {
					t.Fatal(err)
				}
				checkCmd := exec.Command(filepath.Join(runtime.GOROOT(), "bin", "go"), "test", "./cmd", "-count=1")
				checkCmd.Dir = dir
				checkCmd.Env = build.Env
				if output, err := checkCmd.CombinedOutput(); err != nil {
					t.Fatal("trusted snapshot behavior", err, string(output))
				}
			}
		})
	}
}

func TestFunctionTransportBindsExactBuiltinReturnAndArgumentTypes(t *testing.T) {
	for _, source := range []string{
		"type Result int\nfunc Fixture(s string)Result{return 7}\nfunc(Result)MarshalJSON()([]byte,error){return []byte(`7`),nil}\n",
		"type Text string\nfunc Fixture(s Text)int{return 7}\n",
		"func Fixture(s string)any{return 7}\n",
	} {
		dir := t.TempDir()
		s := functionSnapshot("string", "int")
		files, _, err := compilationPlan(s, []byte("package piscine\n"+source))
		if err != nil {
			t.Fatal("trusted type fixture should reach Go type checking", err)
		}
		for _, name := range []string{"piscine", "cmd"} {
			if err := os.Mkdir(filepath.Join(dir, name), 0700); err != nil {
				t.Fatal(err)
			}
		}
		for name, data := range map[string][]byte{"go.mod": files["go.mod"], "piscine/" + s.Contract.File: files[s.Contract.File], "cmd/main.go": files["function-transport"]} {
			if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
				t.Fatal(err)
			}
		}
		build := exec.Command(filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-p=1", "-o", filepath.Join(dir, "program"), "./cmd")
		build.Dir = dir
		build.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOPROXY=off", "GOSUMDB=off", "GOWORK=off", "CGO_ENABLED=0")
		if output, err := build.CombinedOutput(); err == nil || !bytes.Contains(output, []byte("cannot use piscine.Fixture")) {
			t.Fatal("non-exact/custom-marshaler signature compiled", err, string(output))
		}
	}
	for _, row := range []struct{ input, output, signature string }{
		{"int_int", "int", "func(int,int) int"}, {"pointer_int_int", "pointer_int", "func(*int,int)"},
		{"int_slice_int_int", "int_slice_preserved", "func([]int,int,int) int"}, {"string", "int", "func(string) int"},
		{"int_slice", "int_slice_preserved", "func([]int) int"},
	} {
		transport := string(functionAdapter(*functionSnapshot(row.input, row.output).Contract))
		if !strings.Contains(transport, "var invoke "+row.signature+" = piscine.Fixture") {
			t.Fatal("function binding inferred learner type")
		}
		if row.output == "int_slice_preserved" && (!strings.Contains(transport, "post:=snapshot(") || strings.Contains(transport, `"slice":v`)) {
			t.Fatal("poststate retains live learner slice")
		}
	}
}

func TestFunctionCasesAndHostPoststateComparison(t *testing.T) {
	for _, row := range []struct{ input, output, argument, want, actual string }{
		{"int_int", "int", `{"a":-2,"b":3}`, `1`, `[{"return":1}]`},
		{"pointer_int_int", "pointer_int", `{"pointer":8,"value":4}`, `4`, `[{"pointer":4}]`},
		{"int_slice_int_int", "int_slice_preserved", `{"slice":[2,3],"a":0,"b":1}`, `5`, `[{"return":5,"slice":[2,3]}]`},
		{"string", "int", `"abc"`, `3`, `[{"return":3}]`},
		{"int_slice", "int_slice_preserved", `[]`, `0`, `[{"return":0,"slice":[]}]`},
		{"int_slice", "int_slice_preserved", `null`, `0`, `[{"return":0,"slice":null}]`},
	} {
		s := functionSnapshot(row.input, row.output)
		pack := []byte(`[{"input":` + row.argument + `,"expected":` + row.want + `}]`)
		inputs, expected, err := casesFor(map[string][]byte{"cases/public.json": pack, "cases/private.json": pack}, *s.Contract)
		if err != nil || len(inputs) != 2 || expected[0] != row.want {
			t.Fatal("typed private case rejected", err)
		}
		inputs = inputs[:1]
		expected = expected[:1]
		if got := compareFunction(*s.Contract, inputs, expected, []byte(row.actual)); got != "passed" {
			t.Fatal("typed return/poststate rejected", row.input, got)
		}
		for _, bad := range []string{`[{"return":null}]`, `[{"return":"1"}]`, `[{"return":1,"return":1}]`, row.actual + ` []`, `null`, `[]`, `[{}]`} {
			if compareFunction(*s.Contract, inputs, expected, []byte(bad)) != "runtime_error" {
				t.Fatal("invalid transport accepted", bad)
			}
		}
	}
	s := functionSnapshot("int_slice", "int_slice_preserved")
	for _, row := range []struct{ input, actual string }{
		{`[1,2]`, `[{"return":3,"slice":[2,1]}]`},
		{`[]`, `[{"return":3,"slice":null}]`},
		{`null`, `[{"return":3,"slice":[]}]`},
	} {
		if got := compareFunction(*s.Contract, []json.RawMessage{[]byte(row.input)}, []string{"3"}, []byte(row.actual)); got != "failed" {
			t.Fatal("slice promise ignored", got)
		}
	}
	for _, row := range []struct{ input, bad string }{
		{"int_int", `{"a":1}`}, {"int_int", `{"a":null,"b":2}`}, {"int_int", `{"a":1.5,"b":2}`}, {"int_int", `{"a":9223372036854775808,"b":2}`},
		{"pointer_int_int", `{"pointer":1,"value":2,"other":0}`}, {"int_slice", `[null]`}, {"int_slice_int_int", `{"slice":[1],"a":0,"b":null}`}, {"string", `null`},
	} {
		s := functionSnapshot(row.input, "int")
		if _, err := functionInput(*s.Contract, []byte(row.bad)); err == nil {
			t.Fatal("invalid typed input accepted", row)
		}
	}
	for _, want := range []string{`null`, `"1"`, `1.1`, `9223372036854775808`} {
		data := []byte(`[{"input":[1],"expected":` + want + `}]`)
		if _, _, err := functionCases(map[string][]byte{"cases/public.json": data, "cases/private.json": data}, *s.Contract); err == nil {
			t.Fatal("invalid expected integer accepted", want)
		}
	}
}

type fakeFunctionPhase struct{ fakeProgramPhase }

func (p *fakeFunctionPhase) Exec(ctx context.Context, command, env []string, input []byte, limit int) ([]byte, []byte, int, error) {
	if len(command) == 3 && command[0] == "/bin/sh" && command[2] == "exec /workspace/program 3>&1 1>&2" {
		return p.fakeProgramPhase.Exec(ctx, []string{"/workspace/program"}, env, input, limit)
	}
	return p.fakeProgramPhase.Exec(ctx, command, env, input, limit)
}

type fakeFunctionEngine struct {
	phase   *fakeFunctionPhase
	creates int
}

func (e *fakeFunctionEngine) VerifyImage(context.Context, string) error { return nil }
func (e *fakeFunctionEngine) Create(context.Context, string, bool) (gradingPhase, error) {
	e.creates++
	return e.phase, nil
}

func TestFunctionExecutionUsesSeparatedTransportAndVerifiedLifecycle(t *testing.T) {
	for _, row := range []struct {
		name           string
		response       programResponse
		resource, want string
		infra          bool
	}{
		{"passed", programResponse{out: []byte(`[{"return":7}]`)}, "", "passed", false},
		{"wrong", programResponse{out: []byte(`[{"return":8}]`)}, "", "failed", false},
		{"stdout", programResponse{out: []byte(`[{"return":7}]`), stderr: []byte(`[{"return":7}]`)}, "", "runtime_error", false},
		{"malformed", programResponse{out: []byte(`[{"return":7}] []`)}, "", "runtime_error", false},
		{"exit", programResponse{exit: 2}, "", "runtime_error", false},
		{"timeout", programResponse{err: context.DeadlineExceeded}, "", "timeout", false},
		{"output", programResponse{err: sandbox.ErrOutput}, "", "runtime_error", false},
		{"transport", programResponse{err: sandbox.ErrInfrastructure}, "", "", true},
		{"oom", programResponse{out: []byte(`[{"return":7}]`)}, "oom", "runtime_error", false},
		{"probe", programResponse{out: []byte(`[{"return":7}]`)}, "missing", "", true},
	} {
		t.Run(row.name, func(t *testing.T) {
			p := &fakeFunctionPhase{fakeProgramPhase: fakeProgramPhase{responses: []programResponse{row.response}, resource: row.resource}}
			e := Executor{engine: &fakeFunctionEngine{phase: p}}
			s := functionSnapshot("int_int", "int")
			inputs := []json.RawMessage{[]byte(`{"a":3,"b":4}`)}
			v, err := e.execute(context.Background(), s, []byte("trusted-binary-fixture"), inputs, []string{"7"}, map[string]int64{})
			if v != row.want || (err != nil) != row.infra || p.closed != 1 || len(p.files) != 1 {
				t.Fatal("v3 lifecycle/classification", v, err, p.closed)
			}
			want, _ := json.Marshal(inputs)
			if len(p.inputs) != 1 || !bytes.Equal(p.inputs[0], want) || bytes.Contains(p.inputs[0], []byte("expected")) {
				t.Fatal("oracle entered runtime")
			}
		})
	}
	p := &fakeFunctionPhase{fakeProgramPhase: fakeProgramPhase{responses: []programResponse{{out: []byte(`[{"return":7}]`)}}, stopErr: errors.New("unit-only uncertain stop")}}
	v, err := (Executor{engine: &fakeFunctionEngine{phase: p}}).execute(context.Background(), functionSnapshot("int_int", "int"), nil, []json.RawMessage{[]byte(`{"a":3,"b":4}`)}, []string{"7"}, map[string]int64{})
	if v != "" || !errors.Is(err, sandbox.ErrInfrastructure) || p.closed != 1 {
		t.Fatal("unconfirmed stop released verdict", v, err)
	}
}
