package executor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"nextera.local/runner/internal/protocol"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCaseTypesFailClosed(t *testing.T) {
	for _, id := range []string{"hello-go-v1", "even-or-odd-v1"} {
		for _, input := range []string{`[]`, `[{"input":null,"expected":"x"}]`, `[{"input":true,"expected":"x"}]`, `[{"input":1.5,"expected":"x"}]`, `[{"input":0,"expected":null}]`, `[{"input":0}]`, `[{"input":0,"input":1,"expected":"x"}]`, `[{"input":9223372036854775808,"expected":"x"}]`} {
			if _, _, err := cases(map[string][]byte{"cases/public.json": []byte(input), "cases/private.json": []byte(input)}, id); err == nil {
				t.Fatal("invalid trusted input accepted")
			}
		}
	}
	for _, pair := range [][2]string{{"hello-go-v1", `[{"input":"public","expected":"public"}]`}, {"even-or-odd-v1", `[{"input":-9223372036854775808,"expected":"odd"}]`}} {
		if inputs, expected, err := cases(map[string][]byte{"cases/public.json": []byte(pair[1]), "cases/private.json": []byte(pair[1])}, pair[0]); err != nil || len(inputs) != 2 || len(expected) != 2 {
			t.Fatal("valid typed cases rejected")
		}
	}
}
func TestSourceDigestAndBounds(t *testing.T) {
	file := filepath.Join(t.TempDir(), "reader.jwt")
	if os.WriteFile(file, []byte("unit-only-credential"), 0600) != nil {
		t.Fatal("fixture")
	}
	content := []byte("public source fixture")
	hash := sha256.Sum256(content)
	source := protocol.Source{Bucket: "nextera-submissions", Key: "public-fixture", Size: int64(len(content)), Digest: hex.EncodeToString(hash[:])}
	var payload = []byte("public source fixture")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer unit-only-credential" {
			t.Error("missing scoped credential")
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	e := Executor{StorageURL: server.URL, TokenFile: file}
	if _, err := e.source(context.Background(), source); err != nil {
		t.Fatal("valid source rejected")
	}
	payload = []byte("changed source bytes")
	if _, err := e.source(context.Background(), source); err == nil || err.Error() != "ARTIFACT_MISMATCH" {
		t.Fatal("changed digest accepted")
	}
	payload = []byte(strings.Repeat("x", 262145))
	if _, err := e.source(context.Background(), source); err == nil {
		t.Fatal("oversized object accepted")
	}
	if os.Chmod(file, 0644) != nil {
		t.Fatal("fixture")
	}
	if _, err := e.source(context.Background(), source); err == nil {
		t.Fatal("public credential file accepted")
	}
}
func TestStorageRedirectDoesNotForwardCredentials(t *testing.T) {
	leaked := false
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaked = true }))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, http.StatusFound) }))
	defer redirect.Close()
	file := filepath.Join(t.TempDir(), "token")
	_ = os.WriteFile(file, []byte("unit"), 0600)
	e := Executor{StorageURL: redirect.URL, TokenFile: file}
	_, err := e.source(context.Background(), protocol.Source{Bucket: "nextera-submissions", Key: "x", Size: 1})
	if err == nil || leaked {
		t.Fatal("redirect followed")
	}
}
func TestTransportAdapterHasNoOracle(t *testing.T) {
	for _, id := range []string{"hello-go-v1", "even-or-odd-v1"} {
		a := string(adapter(id))
		for _, forbidden := range []string{"expected", "private.json", "bridge.go", "testCase", "passed", "failed"} {
			if strings.Contains(a, forbidden) {
				t.Fatal("assessment material in public adapter")
			}
		}
	}
}
