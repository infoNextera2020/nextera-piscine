import { randomUUID } from 'node:crypto';
import {
  prepareQuestReview,
  submitQuestReview,
  type QuestReviewRuntime,
} from '@nextera/db/operations/quest-reviews';
import {
  createQuestReviewPostgresRepository,
  nativeQuestReviewAuthority,
  nativeQuestReviewSelection,
} from '@nextera/db/quest-review-postgres';
import { getDatabaseClient, requireDomainUser } from '../../../lib/auth/server';

export const runtime = 'nodejs';

function createServerRuntime(): QuestReviewRuntime {
  return {
    nowMs: () => Date.now(),
    nextId: () => randomUUID(),
    sampler: {
      policyVersion: 'selection-1',
      select: async (bank) => bank.questionIds.slice(0, 5),
    },
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireDomainUser();
    const client = getDatabaseClient();
    const url = new URL(request.url);
    const cohortId = url.searchParams.get('cohortId');

    // 1. If reviewer (peer or mentor), fetch their assigned reviews via security definer function
    const assignments = await client`
      SELECT assignment_id, cycle_id, cohort_id, quest_key, learner_id, kind, assigned_at_ms,
             question_ids, learner_name, existing_decision
      FROM app.quest_review_reviewer_assignments(${user.id}::uuid, ${cohortId ? cohortId : null}::uuid)
    `;

    // 2. If learner, fetch their own review cycle via security definer function
    const ownCycles = await client`
      SELECT cycle_id, cohort_id, quest_key, question_ids, recorded_at,
             peer_receipts_count, mentor_verdict
      FROM app.quest_review_learner_cycles(${user.id}::uuid, ${cohortId ? cohortId : null}::uuid)
    `;

    return Response.json({
      userId: user.id,
      role: user.role,
      assignedReviews: assignments,
      ownCycles,
    });
  } catch (error) {
    console.error('API POST ERROR:', error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireDomainUser();
    const client = getDatabaseClient();
    const body = await request.json();

    const repository = createQuestReviewPostgresRepository({
      client,
      authority: nativeQuestReviewAuthority,
      selection: nativeQuestReviewSelection,
      limits: {
        transactionMs: 10000,
        statementMs: 5000,
        lockMs: 2000,
        maxGraphEdges: 100,
        maxMetadataBytes: 65536,
      },
    });

    const runtime = createServerRuntime();

    if (body.action === 'prepare') {
      const { cohortId, questKey } = body;
      if (!cohortId || !questKey) {
        return Response.json({ error: 'MISSING_FIELDS' }, { status: 400 });
      }

      const summary = await prepareQuestReview(repository, runtime, {
        scope: { cohortId, questKey, learnerId: user.id },
        subjectId: user.authUserId,
      });

      return Response.json({
        ok: true,
        summary: {
          cycleId: summary.cycle.cycleId,
          questionIds: summary.cycle.questionIds,
          eligibility: summary.eligibility,
          assignmentState: summary.assignmentState,
        },
      });
    }

    if (body.action === 'submit') {
      const { cohortId, questKey, learnerId, cycleId, assignmentId, decision } = body;
      if (!cohortId || !questKey || !learnerId || !cycleId || !assignmentId || !decision) {
        return Response.json({ error: 'MISSING_FIELDS' }, { status: 400 });
      }

      const requestId = randomUUID();
      const result = await submitQuestReview(repository, runtime, {
        scope: { cohortId, questKey, learnerId },
        subjectId: user.authUserId,
        cycleId,
        assignmentId,
        requestId,
        decision,
      });

      return Response.json({
        ok: true,
        receipt: {
          id: result.receipt.id,
          decision: result.receipt.decision,
        },
        eligibility: result.eligibility,
      });
    }

    return Response.json({ error: 'UNKNOWN_ACTION' }, { status: 400 });
  } catch (error) {
    console.error('API POST ERROR:', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('FORBIDDEN') ? 403 : message.includes('CONFLICT') ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
