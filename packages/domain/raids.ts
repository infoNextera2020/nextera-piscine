import type { SubmissionState } from './states.ts';

export const RAID_TEAM_SIZE = 3;
export const RAID_REVIEW_DECISIONS = ['approved', 'changes_requested'] as const;
export type RaidReviewDecision = (typeof RAID_REVIEW_DECISIONS)[number];
export type RaidStatus =
  | 'awaiting_checks'
  | 'attention_required'
  | 'changes_required'
  | 'awaiting_review'
  | 'owner_decision_required'
  | 'completed'
  | 'superseded';

export type RaidMember = { id: string; displayName: string };
export type RaidAttemptView = {
  id: string;
  ordinal: number;
  created_at: string;
  filename: string;
  artifact_digest: string;
  uploader: string;
  members: RaidMember[];
  automated_state: SubmissionState;
  feedback: { message: string } | null;
  review: { decision: RaidReviewDecision; feedback: string; created_at: string } | null;
  outcome_id: string | null;
  status: RaidStatus;
};
export type RaidView = {
  team: { id: string; name: string; members: RaidMember[]; mentor: string } | null;
  attempts: RaidAttemptView[];
  can_submit: boolean;
  can_review: boolean;
};

/** Approved contract: exactly three distinct members. Identities are resolved by the server. */
export function assertRaidRoster(members: readonly string[]) {
  if (
    members.length !== RAID_TEAM_SIZE ||
    new Set(members).size !== RAID_TEAM_SIZE ||
    members.some((id) => !id)
  )
    throw new Error('RAID_REQUIRES_THREE_MEMBERS');
}

export function raidStatus(input: {
  automated: SubmissionState;
  review?: RaidReviewDecision | null;
  completed?: boolean;
  superseded?: boolean;
  accessRemoved?: boolean;
}): RaidStatus {
  // Durable completion is historical evidence; current access is enforced separately.
  if (input.completed) return 'completed';
  if (input.superseded) return 'superseded';
  if (input.accessRemoved) return 'owner_decision_required';
  if (['queued', 'running'].includes(input.automated)) return 'awaiting_checks';
  if (['system_error', 'cancelled'].includes(input.automated)) return 'attention_required';
  if (input.automated !== 'passed' || input.review === 'changes_requested')
    return 'changes_required';
  // Approval is a gate, not a browser-authoritative completion or unlock.
  return 'awaiting_review';
}

export function assertRaidReview(input: {
  reviewer: string;
  assignedMentor: string;
  reviewerActive: boolean;
  memberIds: readonly string[];
  automated: SubmissionState;
  accessRemoved: boolean;
  currentAttempt: boolean;
}) {
  assertRaidRoster(input.memberIds);
  if (
    !input.reviewerActive ||
    input.reviewer !== input.assignedMentor ||
    input.memberIds.includes(input.reviewer)
  )
    throw new Error('RAID_REVIEW_FORBIDDEN');
  if (!input.currentAttempt) throw new Error('RAID_ATTEMPT_SUPERSEDED');
  if (input.accessRemoved) throw new Error('RAID_OWNER_DECISION_REQUIRED');
  if (input.automated !== 'passed') throw new Error('RAID_CHECKS_NOT_PASSED');
}
