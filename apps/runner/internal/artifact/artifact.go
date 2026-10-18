// Package artifact verifies private OCI layouts without exposing their payloads.
package artifact

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
)

const Toolchain = "go1.27.2"
const Platform = "linux/amd64"
const Profile = "go-functions-pilot-v1"
const ArtifactType = "application/vnd.nextera.testpack.v1"

var digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var referencePattern = regexp.MustCompile(`^oci://[a-zA-Z0-9./_:-]+@sha256:[a-f0-9]{64}$`)

// Failures are infrastructure classifications, with no paths or payload data.
var ErrInvalid = errors.New("system_error: ARTIFACT_VERIFICATION_FAILED")

type Limits struct {
	CPU       float64 `json:"cpu_limit"`
	Memory    int64   `json:"memory_bytes"`
	PIDs      int     `json:"pid_limit"`
	Timeout   int     `json:"timeout_ms"`
	Output    int     `json:"output_bytes"`
	Temporary int     `json:"temporary_filesystem_bytes"`
	Inodes    int     `json:"temporary_filesystem_inodes"`
}
type Resources struct {
	Compilation Limits `json:"compilation"`
	Execution   Limits `json:"execution"`
}

func PilotResources() Resources {
	return Resources{Limits{1, 512 << 20, 64, 20000, 65536, 256 << 20, 16384}, Limits{1, 64 << 20, 32, 2000, 65536, 16 << 20, 1024}}
}

type Generation struct {
	Mode string `json:"mode"`
}
type Environment struct {
	Sandbox      string     `json:"sandbox_image_digest"`
	Toolchain    string     `json:"toolchain_version"`
	Platform     string     `json:"target_platform"`
	Flags        []string   `json:"build_flags"`
	Dependencies string     `json:"dependency_policy"`
	Profile      string     `json:"resource_profile"`
	Resources    Resources  `json:"resource_limits"`
	Protocol     int        `json:"protocol_version"`
	Snapshot     int        `json:"snapshot_format_version"`
	Generation   Generation `json:"case_generation"`
}
type Entry struct {
	Digest   string  `json:"test_pack_digest"`
	Artifact *string `json:"test_pack_artifact"`
	Runner   string  `json:"runner_image_digest"`
	Environment
}
type Catalog struct {
	Format int              `json:"format_version"`
	Packs  map[string]Entry `json:"test_packs"`
}
type Candidate struct {
	Status   string   `json:"status"`
	Blockers []string `json:"blockers"`
	Catalog  Catalog  `json:"catalog"`
}
type Metadata struct {
	Format int    `json:"format_version"`
	ID     string `json:"test_pack_id"`
	Environment
}
type Descriptor struct {
	Media  string `json:"mediaType"`
	Digest string `json:"digest"`
	Size   int64  `json:"size"`
}
type Manifest struct {
	Schema       int          `json:"schemaVersion"`
	Media        string       `json:"mediaType"`
	ArtifactType string       `json:"artifactType"`
	Config       Descriptor   `json:"config"`
	Layers       []Descriptor `json:"layers"`
}

// Strict rejects unknown fields, trailing data, and duplicate object keys.
func Strict(data []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	var walk func() error
	walk = func() error {
		t, err := d.Token()
		if err != nil {
			return err
		}
		if delim, ok := t.(json.Delim); ok {
			switch delim {
			case '{':
				seen := map[string]bool{}
				for d.More() {
					k, e := d.Token()
					if e != nil {
						return e
					}
					s, ok := k.(string)
					if !ok || seen[s] {
						return ErrInvalid
					}
					seen[s] = true
					if e = walk(); e != nil {
						return e
					}
				}
			case '[':
				for d.More() {
					if e := walk(); e != nil {
						return e
					}
				}
			default:
				return ErrInvalid
			}
			_, err = d.Token()
			return err
		}
		return nil
	}
	if err := walk(); err != nil {
		return ErrInvalid
	}
	if _, err := d.Token(); err != io.EOF {
		return ErrInvalid
	}
	d = json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil {
		return ErrInvalid
	}
	return nil
}
func (e Environment) Valid() bool {
	return digestPattern.MatchString(e.Sandbox) && e.Toolchain == Toolchain && e.Platform == Platform &&
		reflect.DeepEqual(e.Flags, []string{"-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid="}) &&
		e.Dependencies == "offline" && e.Profile == Profile && e.Resources == PilotResources() &&
		e.Protocol == 1 && e.Snapshot == 1 && e.Generation.Mode == "static"
}
func (c Catalog) Validate(allowLocal bool) error {
	if c.Format != 1 || len(c.Packs) != 2 {
		return ErrInvalid
	}
	for _, id := range []string{"hello-go-v1", "even-or-odd-v1"} {
		e, ok := c.Packs[id]
		if !ok || !digestPattern.MatchString("sha256:"+e.Digest) || !digestPattern.MatchString(e.Runner) || !e.Environment.Valid() {
			return ErrInvalid
		}
		if e.Artifact == nil {
			if !allowLocal {
				return ErrInvalid
			}
			continue
		}
		if !referencePattern.MatchString(*e.Artifact) || !bytes.HasSuffix([]byte(*e.Artifact), []byte("@sha256:"+e.Digest)) {
			return ErrInvalid
		}
	}
	return nil
}
func ReadCandidate(path string) (Catalog, error) {
	b, err := limitedFile(path, 65536)
	if err != nil {
		return Catalog{}, ErrInvalid
	}
	var c Candidate
	if Strict(b, &c) != nil || c.Status != "CANDIDATE" || len(c.Blockers) == 0 || c.Catalog.Validate(true) != nil {
		return Catalog{}, ErrInvalid
	}
	return c.Catalog, nil
}
func limitedFile(path string, limit int64) ([]byte, error) {
	i, err := os.Lstat(path)
	if err != nil || !i.Mode().IsRegular() || i.Size() > limit {
		return nil, ErrInvalid
	}
	b, err := os.ReadFile(path)
	if err != nil || int64(len(b)) > limit {
		return nil, ErrInvalid
	}
	return b, nil
}
func hash(b []byte) string { h := sha256.Sum256(b); return "sha256:" + hex.EncodeToString(h[:]) }
func blob(layout string, d Descriptor) ([]byte, error) {
	if !digestPattern.MatchString(d.Digest) || d.Size < 0 || d.Size > 8<<20 {
		return nil, ErrInvalid
	}
	p := filepath.Join(layout, "blobs", "sha256", d.Digest[7:])
	info, err := os.Lstat(p)
	if err != nil || !info.Mode().IsRegular() || info.Size() != d.Size {
		return nil, ErrInvalid
	}
	b, err := os.ReadFile(p)
	if err != nil || hash(b) != d.Digest {
		return nil, ErrInvalid
	}
	return b, nil
}

// Verify reads only digest-addressed blobs; it never extracts or runs pack code.
func Verify(layout, id string, entry Entry) error {
	if !digestPattern.MatchString("sha256:"+entry.Digest) || !entry.Environment.Valid() {
		return ErrInvalid
	}
	format, err := limitedFile(filepath.Join(layout, "oci-layout"), 1024)
	if err != nil || string(format) != `{"imageLayoutVersion":"1.0.0"}` {
		return ErrInvalid
	}
	indexBytes, err := limitedFile(filepath.Join(layout, "index.json"), 65536)
	var index struct {
		Schema    int          `json:"schemaVersion"`
		Manifests []Descriptor `json:"manifests"`
	}
	if err != nil || Strict(indexBytes, &index) != nil || index.Schema != 2 || len(index.Manifests) != 1 || index.Manifests[0].Digest != "sha256:"+entry.Digest {
		return ErrInvalid
	}
	info, err := os.Lstat(filepath.Join(layout, "blobs", "sha256", entry.Digest))
	if err != nil {
		return ErrInvalid
	}
	if index.Manifests[0].Size != info.Size() || index.Manifests[0].Media != "application/vnd.oci.image.manifest.v1+json" {
		return ErrInvalid
	}
	b, err := blob(layout, Descriptor{Digest: "sha256:" + entry.Digest, Size: info.Size()})
	if err != nil {
		return err
	}
	var m Manifest
	if Strict(b, &m) != nil || m.Schema != 2 || m.Media != "application/vnd.oci.image.manifest.v1+json" || m.ArtifactType != ArtifactType || len(m.Layers) != 1 {
		return ErrInvalid
	}
	config, err := blob(layout, m.Config)
	if err != nil || string(config) != "{}" || m.Config.Media != "application/vnd.oci.empty.v1+json" {
		return ErrInvalid
	}
	layer, err := blob(layout, m.Layers[0])
	if err != nil || m.Layers[0].Media != "application/vnd.nextera.testpack.v1.tar" {
		return ErrInvalid
	}
	r := tar.NewReader(bytes.NewReader(layer))
	seen := map[string]bool{}
	allowed := map[string]bool{"metadata.json": true, "cases/public.json": true, "cases/private.json": true, "harness/bridge.go": true, "feedback.json": true}
	for {
		h, e := r.Next()
		if e == io.EOF {
			break
		}
		if e != nil || h.Typeflag != tar.TypeReg || !allowed[h.Name] || seen[h.Name] || h.Size > 1<<20 || h.Size < 0 {
			return ErrInvalid
		}
		seen[h.Name] = true
		data, e := io.ReadAll(io.LimitReader(r, 1<<20))
		if e != nil {
			return ErrInvalid
		}
		if h.Name == "metadata.json" {
			var meta Metadata
			if Strict(data, &meta) != nil || meta.Format != 1 || meta.ID != id || !reflect.DeepEqual(meta.Environment, entry.Environment) {
				return ErrInvalid
			}
		}
	}
	if len(seen) != len(allowed) {
		return ErrInvalid
	}
	return nil
}
