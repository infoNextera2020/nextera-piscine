package atm

import (
	"bytes"
	"encoding/json"
	"nextera.local/runner/internal/artifact"
	"testing"
)

// Synthetic cross-language vector produced independently by the TypeScript
// adapter. These hashes are fixtures, not an authentic pack registration.
const goldenWire = `{"syntheticOnly":true,"resolve":{"version":1,"jobId":"10000000-0000-4000-8000-000000000001","judgeAttemptId":"10000000-0000-4000-8000-000000000002","workerId":"10000000-0000-4000-8000-000000000003","generation":"9007199254740993","submissionId":"10000000-0000-4000-8000-000000000004","evaluationSnapshotDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"context":{"version":1,"jobId":"10000000-0000-4000-8000-000000000001","judgeAttemptId":"10000000-0000-4000-8000-000000000002","workerId":"10000000-0000-4000-8000-000000000003","generation":"9007199254740993","submissionId":"10000000-0000-4000-8000-000000000004","raidAttemptId":"10000000-0000-4000-8000-000000000005","teamId":"10000000-0000-4000-8000-000000000006","cohortId":"10000000-0000-4000-8000-000000000007","curriculumVersionId":"10000000-0000-4000-8000-000000000008","nodeKey":"project-1","sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","evaluationSnapshotDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","evaluationSpecDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","definitionDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","testPackId":"atm-private-fixture","testPackDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","semanticProfileDigest":"f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007","runnerImageDigest":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","resourcePolicyDigest":"1111111111111111111111111111111111111111111111111111111111111111","modelId":"atm-independent-model-v1","caseCount":2,"contextDigest":"b7ba1ac93185deceb0254441d03f614918ae7c6a5c34f6429b6f8b7f4f78b44f"},"retain":{"version":1,"operationId":"10000000-0000-4000-8000-000000000010","context":{"version":1,"jobId":"10000000-0000-4000-8000-000000000001","judgeAttemptId":"10000000-0000-4000-8000-000000000002","workerId":"10000000-0000-4000-8000-000000000003","generation":"9007199254740993","submissionId":"10000000-0000-4000-8000-000000000004","raidAttemptId":"10000000-0000-4000-8000-000000000005","teamId":"10000000-0000-4000-8000-000000000006","cohortId":"10000000-0000-4000-8000-000000000007","curriculumVersionId":"10000000-0000-4000-8000-000000000008","nodeKey":"project-1","sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","evaluationSnapshotDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","evaluationSpecDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","definitionDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","testPackId":"atm-private-fixture","testPackDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","semanticProfileDigest":"f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007","runnerImageDigest":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","resourcePolicyDigest":"1111111111111111111111111111111111111111111111111111111111111111","modelId":"atm-independent-model-v1","caseCount":2,"contextDigest":"b7ba1ac93185deceb0254441d03f614918ae7c6a5c34f6429b6f8b7f4f78b44f"},"captures":[{"caseFile":"cases/public.json","caseIndex":0,"inputSha256":"21ce7352f4a67a3fe7d07a0655fbfd14f7db5e96566cee61702c97368926a890","stdinBase64":"MDQyNwoxCjQK","stdoutBase64":"WyJlbmQiLDEwMF0KUFJJVkFURV9PVVRQVVRfU0VOVElORUw=","stderrBase64":"UFJJVkFURV9TVERFUlJfU0VOVElORUw=","exitCode":0,"transportWriteComplete":true,"stdinHalfClosed":true,"outputComplete":true,"termination":"exited","assessment":"projection_mismatch"}],"captureDigest":"657838bfc5fdc93cfe86f12d994c7c45236f5e5931bde7d511825d9894520602"},"reconcile":{"version":1,"operationId":"10000000-0000-4000-8000-000000000010","context":{"version":1,"jobId":"10000000-0000-4000-8000-000000000001","judgeAttemptId":"10000000-0000-4000-8000-000000000002","workerId":"10000000-0000-4000-8000-000000000003","generation":"9007199254740993","submissionId":"10000000-0000-4000-8000-000000000004","raidAttemptId":"10000000-0000-4000-8000-000000000005","teamId":"10000000-0000-4000-8000-000000000006","cohortId":"10000000-0000-4000-8000-000000000007","curriculumVersionId":"10000000-0000-4000-8000-000000000008","nodeKey":"project-1","sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","evaluationSnapshotDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","evaluationSpecDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","definitionDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","testPackId":"atm-private-fixture","testPackDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","semanticProfileDigest":"f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007","runnerImageDigest":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","resourcePolicyDigest":"1111111111111111111111111111111111111111111111111111111111111111","modelId":"atm-independent-model-v1","caseCount":2,"contextDigest":"b7ba1ac93185deceb0254441d03f614918ae7c6a5c34f6429b6f8b7f4f78b44f"},"captureDigest":"657838bfc5fdc93cfe86f12d994c7c45236f5e5931bde7d511825d9894520602"},"ack":{"version":1,"operationId":"10000000-0000-4000-8000-000000000010","contextDigest":"b7ba1ac93185deceb0254441d03f614918ae7c6a5c34f6429b6f8b7f4f78b44f","captureDigest":"657838bfc5fdc93cfe86f12d994c7c45236f5e5931bde7d511825d9894520602","state":"retained"}}`

func TestATMCrossLanguageContextCaptureAndIntegerGeneration(t *testing.T) {
	var wire struct {
		SyntheticOnly bool            `json:"syntheticOnly"`
		Resolve       ResolveRequest  `json:"resolve"`
		Context       Context         `json:"context"`
		Retain        Envelope        `json:"retain"`
		Reconcile     json.RawMessage `json:"reconcile"`
		Ack           Ack             `json:"ack"`
	}
	if artifact.Strict([]byte(goldenWire), &wire) != nil || !wire.SyntheticOnly {
		t.Fatal("invalid synthetic wire")
	}
	digest, err := wire.Context.Digest()
	if err != nil || digest != wire.Context.ContextDigest || digest != "b7ba1ac93185deceb0254441d03f614918ae7c6a5c34f6429b6f8b7f4f78b44f" {
		t.Fatal("TS/Go context digest differs")
	}
	digest, err = CaptureDigest(wire.Retain.Context, wire.Retain.Captures)
	if err != nil || digest != wire.Retain.CaptureDigest || digest != "657838bfc5fdc93cfe86f12d994c7c45236f5e5931bde7d511825d9894520602" {
		t.Fatal("TS/Go capture digest differs")
	}
	if wire.Resolve.Generation != "9007199254740993" || wire.Context.Generation != wire.Resolve.Generation {
		t.Fatal("generation rounded through float")
	}
	var original map[string]json.RawMessage
	_ = json.Unmarshal([]byte(goldenWire), &original)
	for key, value := range map[string]any{"resolve": wire.Resolve, "context": wire.Context, "retain": wire.Retain, "ack": wire.Ack} {
		var raw any
		_ = json.Unmarshal(original[key], &raw)
		want, _ := Canonical(raw)
		got, _ := Canonical(value)
		if !bytes.Equal(got, want) {
			t.Fatal("Go wire shape differs", key)
		}
	}
}
