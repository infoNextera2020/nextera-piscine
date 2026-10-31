package artifact

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"unicode/utf8"
)

const ScoringManifestPath = "scoring/groups.json"
const CompleteObservationsOnly = "complete-observations-only-v1"

var scoringHash = regexp.MustCompile(`^[a-f0-9]{64}$`)
var scoringKey = regexp.MustCompile(`^[a-z][a-z0-9-]{0,79}$`)

type ScoringGroup struct {
	Key      string
	Criteria string
	Cases    []int
}
type ScoringManifest struct {
	Digest        string
	PublicDigest  string
	PrivateDigest string
	CaseCount     int
	Groups        []ScoringGroup
}
type scoringWire struct {
	Version          int    `json:"version"`
	FailureSemantics string `json:"failureSemantics"`
	CaseFiles        struct {
		Public  string `json:"publicSha256"`
		Private string `json:"privateSha256"`
	} `json:"caseFiles"`
	Groups []struct {
		Key      string `json:"groupKey"`
		Criteria string `json:"criteriaDigest"`
		Cases    []struct {
			Index  *int   `json:"index"`
			Digest string `json:"caseSha256"`
		} `json:"cases"`
	} `json:"groups"`
}

func BytesDigest(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Optional only for explicit q1-q5 ABI3 packs. The manifest is private oracle
// metadata. It contains no weights, rubric/snapshot hashes or inferred groups:
// those identities depend on this pack digest and are bound externally.
func LoadScoring(files map[string][]byte, contract ExecutionContract) (*ScoringManifest, error) {
	raw, present := files[ScoringManifestPath]
	if !present {
		return nil, nil
	}
	if contract.Version != 3 || len(contract.Item) != 2 || contract.Item[0] != 'q' || contract.Item[1] < '1' || contract.Item[1] > '5' ||
		len(raw) == 0 || len(raw) > 1<<20 || !utf8.Valid(raw) {
		return nil, ErrInvalid
	}
	var wire scoringWire
	if Strict(raw, &wire) != nil || wire.Version != 1 || wire.FailureSemantics != CompleteObservationsOnly ||
		!scoringHash.MatchString(wire.CaseFiles.Public) || !scoringHash.MatchString(wire.CaseFiles.Private) || len(wire.Groups) == 0 {
		return nil, ErrInvalid
	}
	manifest := &ScoringManifest{Digest: BytesDigest(raw), PublicDigest: wire.CaseFiles.Public, PrivateDigest: wire.CaseFiles.Private}
	var rows []json.RawMessage
	for i, path := range []string{"cases/public.json", "cases/private.json"} {
		data := files[path]
		digest := wire.CaseFiles.Public
		if i == 1 {
			digest = wire.CaseFiles.Private
		}
		var part []json.RawMessage
		if len(data) == 0 || !utf8.Valid(data) || BytesDigest(data) != digest || Strict(data, &part) != nil || len(part) == 0 || len(part) > 10000 {
			return nil, ErrInvalid
		}
		for _, row := range part {
			var fields map[string]json.RawMessage
			if Strict(row, &fields) != nil || len(fields) != 2 || len(fields["input"]) == 0 || len(fields["expected"]) == 0 {
				return nil, ErrInvalid
			}
		}
		rows = append(rows, part...)
	}
	manifest.CaseCount = len(rows)
	seenGroups := map[string]bool{}
	classified := make([]bool, len(rows))
	for _, group := range wire.Groups {
		if !scoringKey.MatchString(group.Key) || !scoringHash.MatchString(group.Criteria) || seenGroups[group.Key] || len(group.Cases) == 0 {
			return nil, ErrInvalid
		}
		seenGroups[group.Key] = true
		parsed := ScoringGroup{Key: group.Key, Criteria: group.Criteria}
		for _, ref := range group.Cases {
			if ref.Index == nil || *ref.Index < 0 || *ref.Index >= len(rows) || classified[*ref.Index] ||
				!scoringHash.MatchString(ref.Digest) || ref.Digest != BytesDigest(rows[*ref.Index]) {
				return nil, ErrInvalid
			}
			classified[*ref.Index] = true
			parsed.Cases = append(parsed.Cases, *ref.Index)
		}
		manifest.Groups = append(manifest.Groups, parsed)
	}
	for _, covered := range classified {
		if !covered {
			return nil, ErrInvalid
		}
	}
	return manifest, nil
}
