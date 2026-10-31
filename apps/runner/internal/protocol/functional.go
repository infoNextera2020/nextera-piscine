package protocol

import "nextera.local/runner/internal/artifact"

type FunctionalGroup struct {
	GroupKey       string `json:"groupKey"`
	CriteriaDigest string `json:"criteriaDigest"`
	Passed         bool   `json:"passed"`
}

// This internal host report never enters a learner adapter or feedback. Native
// context independently binds its pack/manifest/criteria to the frozen rubric.
type FunctionalReport struct {
	Version                  int               `json:"version"`
	JobID                    string            `json:"jobId"`
	SubmissionID             string            `json:"submissionId"`
	ItemKey                  string            `json:"itemKey"`
	EvaluationSnapshotDigest string            `json:"evaluationSnapshotDigest"`
	EvaluationSpecDigest     string            `json:"evaluationSpecDigest"`
	ArtifactSHA256           string            `json:"artifactSha256"`
	TestPackID               string            `json:"testPackId"`
	TestPackDigest           string            `json:"testPackDigest"`
	ManifestSHA256           string            `json:"manifestSha256"`
	PublicCasesSHA256        string            `json:"publicCasesSha256"`
	PrivateCasesSHA256       string            `json:"privateCasesSha256"`
	CaseCount                int               `json:"caseCount"`
	Groups                   []FunctionalGroup `json:"groups"`
}

func FunctionalFromObservations(s Snapshot, m *artifact.ScoringManifest, observations []bool) (*FunctionalReport, error) {
	if m == nil || m.CaseCount < 1 || len(observations) != m.CaseCount || len(m.Groups) == 0 ||
		!uuid.MatchString(s.VerifiedJob) || !uuid.MatchString(s.Submission) || !hash.MatchString(s.VerifiedDigest) ||
		!hash.MatchString(s.SpecDigest) || !hash.MatchString(s.Source.Digest) || !hash.MatchString(s.Digest) ||
		!hash.MatchString(m.Digest) || !hash.MatchString(m.PublicDigest) || !hash.MatchString(m.PrivateDigest) ||
		s.Contract == nil || s.Contract.Version != 3 || len(s.Contract.Item) != 2 || s.Contract.Item[0] != 'q' || s.Contract.Item[1] < '1' || s.Contract.Item[1] > '5' {
		return nil, ErrIdentity
	}
	report := &FunctionalReport{Version: 1, JobID: s.VerifiedJob, SubmissionID: s.Submission, ItemKey: s.Contract.Item,
		EvaluationSnapshotDigest: s.VerifiedDigest, EvaluationSpecDigest: s.SpecDigest, ArtifactSHA256: s.Source.Digest,
		TestPackID: s.PackID, TestPackDigest: s.Digest, ManifestSHA256: m.Digest, PublicCasesSHA256: m.PublicDigest, PrivateCasesSHA256: m.PrivateDigest, CaseCount: m.CaseCount}
	for _, group := range m.Groups {
		if len(group.Cases) == 0 {
			return nil, ErrIdentity
		}
		passed := true
		for _, index := range group.Cases {
			if index < 0 || index >= len(observations) {
				return nil, ErrIdentity
			}
			passed = passed && observations[index]
		}
		report.Groups = append(report.Groups, FunctionalGroup{GroupKey: group.Key, CriteriaDigest: group.Criteria, Passed: passed})
	}
	return report, nil
}
