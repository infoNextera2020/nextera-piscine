package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"nextera.local/runner/internal/artifact"
	"nextera.local/runner/internal/feedback"
	"os"
	"runtime"
)

var version = "foundation-003"
var revision = "working-tree"

func run(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: runner version|capabilities|verify-artifact")
	}
	switch args[0] {
	case "version", "capabilities":
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"version": version, "revision": revision, "build_toolchain": runtime.Version(), "protocol_versions": []int{1}, "snapshot_format_versions": []int{1}, "target_platform": artifact.Platform, "toolchain_version": artifact.Toolchain, "resource_profile": artifact.Profile, "dependency_policy": "offline"})
	case "verify-catalog":
		f := flag.NewFlagSet("verify-catalog", flag.ContinueOnError)
		f.SetOutput(io.Discard)
		path := f.String("candidate", "", "metadata-only local candidate")
		if f.Parse(args[1:]) != nil || f.NArg() != 0 {
			return artifact.ErrInvalid
		}
		if _, err := artifact.ReadCandidate(*path); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"valid_local_metadata": true, "publication_approved": false})
	case "verify-artifact":
		f := flag.NewFlagSet("verify-artifact", flag.ContinueOnError)
		f.SetOutput(io.Discard)
		layout := f.String("layout", "", "private OCI layout directory")
		catalog := f.String("candidate", "", "local candidate metadata file")
		id := f.String("pack-id", "", "expected test-pack ID")
		if f.Parse(args[1:]) != nil || f.NArg() != 0 {
			return artifact.ErrInvalid
		}
		c, err := artifact.ReadCandidate(*catalog)
		if err != nil {
			return err
		}
		e, ok := c.Packs[*id]
		if !ok {
			return artifact.ErrInvalid
		}
		if artifact.Verify(*layout, *id, e) != nil {
			return artifact.ErrInvalid
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"verified": true, "test_pack_id": *id, "digest": e.Digest, "publication_approved": false})
	default:
		return fmt.Errorf("unknown command")
	}
}
func main() {
	if err := run(os.Args[1:]); err != nil {
		_ = json.NewEncoder(os.Stderr).Encode(feedback.Project("system_error"))
		os.Exit(1)
	}
}
