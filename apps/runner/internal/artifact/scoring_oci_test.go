package artifact

import (
	"archive/tar"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func scoringOCILayout(t *testing.T, files map[string][]byte, contract ExecutionContract) (string, Entry) {
	t.Helper()
	directory := t.TempDir()
	if os.MkdirAll(filepath.Join(directory, "blobs", "sha256"), 0700) != nil {
		t.Fatal("fixture")
	}
	entry := testEntry()
	entry.Contract = &contract
	metadata, _ := json.Marshal(Metadata{Contract: entry.Contract, Format: 1, ID: "exam-q1", Environment: entry.Environment})
	all := map[string][]byte{"metadata.json": metadata, "harness/bridge.go": []byte("private synthetic fixture, never staged"), "feedback.json": []byte("{}")}
	for name, data := range files {
		all[name] = data
	}
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	for name, data := range all {
		if writer.WriteHeader(&tar.Header{Name: name, Mode: 0400, Size: int64(len(data)), Typeflag: tar.TypeReg}) != nil {
			t.Fatal("fixture header")
		}
		if _, err := writer.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if writer.Close() != nil {
		t.Fatal("fixture archive")
	}
	write := func(raw []byte, media string) Descriptor {
		digest := BytesDigest(raw)
		if os.WriteFile(filepath.Join(directory, "blobs", "sha256", digest), raw, 0600) != nil {
			t.Fatal("fixture blob")
		}
		return Descriptor{Media: media, Digest: "sha256:" + digest, Size: int64(len(raw))}
	}
	manifest := Manifest{Schema: 2, Media: "application/vnd.oci.image.manifest.v1+json", ArtifactType: ArtifactType, Config: write([]byte("{}"), "application/vnd.oci.empty.v1+json"),
		Layers: []Descriptor{write(buffer.Bytes(), ArtifactType+".tar")}}
	raw, _ := json.Marshal(manifest)
	descriptor := write(raw, manifest.Media)
	entry.Digest = descriptor.Digest[7:]
	index, _ := json.Marshal(map[string]any{"schemaVersion": 2, "manifests": []Descriptor{descriptor}})
	_ = os.WriteFile(filepath.Join(directory, "index.json"), index, 0600)
	_ = os.WriteFile(filepath.Join(directory, "oci-layout"), []byte(`{"imageLayoutVersion":"1.0.0"}`), 0600)
	return directory, entry
}
func TestScoringOCIInventoryAdmitsOnlyValidatedPrivateGroupMetadata(t *testing.T) {
	files, _, contract := scoringFixture(t)
	directory, entry := scoringOCILayout(t, files, contract)
	verified, err := ReadVerified(directory, "exam-q1", entry)
	if err != nil || len(verified) != 6 || !bytes.Equal(verified[ScoringManifestPath], files[ScoringManifestPath]) {
		t.Fatal("valid digest-verified private scoring pack rejected", err)
	}
	// Rehashing the entire OCI package cannot make a stale case-byte manifest valid.
	files["cases/private.json"] = append(files["cases/private.json"], ' ')
	directory, entry = scoringOCILayout(t, files, contract)
	if Verify(directory, "exam-q1", entry) == nil {
		t.Fatal("fully repacked stale manifest accepted")
	}
	files, _, contract = scoringFixture(t)
	files["scoring/weights.json"] = []byte("{}")
	directory, entry = scoringOCILayout(t, files, contract)
	if Verify(directory, "exam-q1", entry) == nil {
		t.Fatal("unapproved private inventory expanded")
	}
	files, _, contract = scoringFixture(t)
	contract.Version = 2
	contract.File = "main.go"
	contract.Function = ""
	contract.Input = "stdin_utf8"
	contract.Output = "stdout_utf8_exact"
	directory, entry = scoringOCILayout(t, files, contract)
	if Verify(directory, "exam-q1", entry) == nil {
		t.Fatal("ABI2 silently acquired group scoring")
	}
}
