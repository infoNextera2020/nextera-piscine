package artifact

import (
	"archive/tar"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testEntry() Entry {
	return Entry{Digest: strings.Repeat("a", 64), Runner: "sha256:" + strings.Repeat("b", 64), Environment: Environment{
		Sandbox: "sha256:" + strings.Repeat("c", 64), Toolchain: Toolchain, Platform: Platform,
		Flags: []string{"-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid="}, Dependencies: "offline", Profile: Profile,
		Resources: PilotResources(), Protocol: 1, Snapshot: 1, Generation: Generation{"static"}}}
}
func TestStrictMetadata(t *testing.T) {
	for _, value := range []string{`{"format_version":1,"format_version":1}`, `{} {}`, `{"secret":"private"}`} {
		var meta Metadata
		if Strict([]byte(value), &meta) == nil {
			t.Fatal("accepted ambiguous/unknown metadata")
		}
	}
}
func TestCatalogCompatibility(t *testing.T) {
	e := testEntry()
	c := Catalog{1, map[string]Entry{"hello-go-v1": e, "even-or-odd-v1": e}}
	if c.Validate(true) != nil {
		t.Fatal("local metadata rejected")
	}
	if c.Validate(false) == nil {
		t.Fatal("local candidate became publishable")
	}
	for _, mutate := range []func(*Entry){
		func(e *Entry) { e.Protocol = 2 }, func(e *Entry) { e.Toolchain = "go0.0.0" }, func(e *Entry) { e.Sandbox = "latest" },
		func(e *Entry) { e.Resources.Execution.Timeout = 2001 }, func(e *Entry) { e.Flags = nil }, func(e *Entry) { e.Dependencies = "online" },
		func(e *Entry) { e.Snapshot = 2 }, func(e *Entry) { e.Platform = "linux/arm64" }, func(e *Entry) { e.Resources.Compilation.Memory = 1 },
	} {
		bad := testEntry()
		mutate(&bad)
		if bad.Environment.Valid() {
			t.Fatal("incompatible environment accepted")
		}
	}
	ref := "oci://private.example/packs@sha256:" + e.Digest
	e.Artifact = &ref
	c.Packs["hello-go-v1"] = e
	c.Packs["even-or-odd-v1"] = e
	if c.Validate(false) != nil {
		t.Fatal("complete immutable metadata rejected")
	}
	c.Packs["unexpected"] = e // Missing trusted execution contract must fail.
	if c.Validate(false) == nil {
		t.Fatal("extra catalog pack accepted")
	}
}
func layout(t *testing.T, id string, e Entry) (string, Entry) {
	t.Helper()
	p := t.TempDir()
	if err := os.MkdirAll(filepath.Join(p, "blobs", "sha256"), 0700); err != nil {
		t.Fatal(err)
	}
	write := func(b []byte, media string) Descriptor {
		d := Descriptor{media, hash(b), int64(len(b))}
		if err := os.WriteFile(filepath.Join(p, "blobs", "sha256", d.Digest[7:]), b, 0600); err != nil {
			t.Fatal(err)
		}
		return d
	}
	meta, _ := json.Marshal(Metadata{Contract: e.Contract, Format: 1, ID: id, Environment: e.Environment})
	var buffer bytes.Buffer
	tw := tar.NewWriter(&buffer)
	for _, name := range []string{"metadata.json", "cases/public.json", "cases/private.json", "harness/bridge.go", "feedback.json"} {
		b := []byte("[]")
		if name == "metadata.json" {
			b = meta
		}
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0400, Size: int64(len(b)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(b); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	m := Manifest{2, "application/vnd.oci.image.manifest.v1+json", ArtifactType, write([]byte("{}"), "application/vnd.oci.empty.v1+json"), []Descriptor{write(buffer.Bytes(), ArtifactType+".tar")}}
	b, _ := json.Marshal(m)
	d := write(b, m.Media)
	e.Digest = d.Digest[7:]
	index, _ := json.Marshal(map[string]any{"schemaVersion": 2, "manifests": []Descriptor{d}})
	if err := os.WriteFile(filepath.Join(p, "index.json"), index, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(p, "oci-layout"), []byte(`{"imageLayoutVersion":"1.0.0"}`), 0600); err != nil {
		t.Fatal(err)
	}
	return p, e
}
func TestVerifyArtifacts(t *testing.T) {
	p, e := layout(t, "hello-go-v1", testEntry())
	if Verify(p, "hello-go-v1", e) != nil {
		t.Fatal("valid layout rejected")
	}
	if Verify(p, "even-or-odd-v1", e) == nil {
		t.Fatal("wrong pack ID accepted")
	}
	bad := e
	bad.Digest = strings.Repeat("0", 64)
	if Verify(p, "hello-go-v1", bad) == nil {
		t.Fatal("digest mismatch accepted")
	}
	bad = e
	bad.Protocol = 2
	if Verify(p, "hello-go-v1", bad) == nil {
		t.Fatal("incompatible protocol accepted")
	}
	bad = e
	bad.Sandbox = "sha256:" + strings.Repeat("d", 64)
	if Verify(p, "hello-go-v1", bad) == nil {
		t.Fatal("wrong sandbox accepted")
	}
	if err := os.WriteFile(filepath.Join(p, "blobs", "sha256", e.Digest), []byte("tamper"), 0600); err != nil {
		t.Fatal(err)
	}
	if Verify(p, "hello-go-v1", e) == nil {
		t.Fatal("tampered manifest accepted")
	}
}

func TestGenericTrustedContract(t *testing.T) {
	e := testEntry()
	e.Contract = &ExecutionContract{1, "normalize-label", "normalize.go", "NormalizeLabel", "string", "string"}
	c := Catalog{1, map[string]Entry{"checkpoint-normalize-v1": e}}
	if c.Validate(true) != nil {
		t.Fatal("trusted declared contract rejected")
	}
	p, verified := layout(t, "checkpoint-normalize-v1", e)
	if Verify(p, "checkpoint-normalize-v1", verified) != nil {
		t.Fatal("verified generic pack rejected")
	}
	bad := *verified.Contract
	bad.Function = "Injected();evil"
	verified.Contract = &bad
	if Verify(p, "checkpoint-normalize-v1", verified) == nil {
		t.Fatal("contract mismatch accepted")
	}
	for _, mutate := range []func(*ExecutionContract){
		func(c *ExecutionContract) { c.Function = "main" }, func(c *ExecutionContract) { c.File = "../source.go" }, func(c *ExecutionContract) { c.Input = "any" }, func(c *ExecutionContract) { c.Output = "bytes" }, func(c *ExecutionContract) { c.Version = 2 },
	} {
		v := *e.Contract
		mutate(&v)
		if _, err := ContractFor("checkpoint-normalize-v1", &v); err == nil {
			t.Fatal("unsafe contract accepted")
		}
	}
	if _, err := ContractFor("untrusted-pack", nil); err == nil {
		t.Fatal("undeclared pack accepted")
	}
}
