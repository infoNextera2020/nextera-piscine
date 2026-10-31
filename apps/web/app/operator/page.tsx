import { loadAssignedScoredExamReview } from '../../components/operator/scored-exam-review-loader';
import { StaffExamReviewDetail } from '../../components/operator/staff-exam-review-detail';
import styles from '../../components/operator/staff.module.css';
import { readRaidQueue } from '@nextera/db/raids';
import { authorizePage, getDatabase } from '../../lib/auth/server';
import { AdminOverview, MentorOverview } from '../../components/operator/staff-overview';
import { StaffShell } from '../../components/operator/staff-shell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function OperatorPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await authorizePage(['operator', 'admin']);
  const params = (await props.searchParams) ?? {};
  if (Object.hasOwn(params, 'attempt') || Object.hasOwn(params, 'submission')) {
    const attempt = params.attempt,
      submission = params.submission;
    const selected =
      typeof attempt === 'string' &&
      (submission === undefined || typeof submission === 'string') &&
      Object.keys(params).every((k) => ['attempt', 'submission'].includes(k))
        ? await loadAssignedScoredExamReview({
            attemptId: attempt,
            ...(submission !== undefined ? { submissionId: submission } : {}),
          })
        : { kind: 'invalid_input' as const };
    return (
      <StaffShell
        user={{ displayName: user.displayName, role: user.role === 'admin' ? 'admin' : 'operator' }}
        active="reviews"
      >
        {selected.kind === 'available' ? (
          <StaffExamReviewDetail
            identity={selected.identity}
            {...(typeof submission === 'string' ? { submissionId: submission } : {})}
          />
        ) : (
          <section className={styles.unavailable}>
            <h1>Assigned exam review unavailable</h1>
            <p>
              {selected.kind === 'forbidden'
                ? 'This attempt is not available to the current assigned staff identity.'
                : selected.kind === 'invalid_input'
                  ? 'Use an exact attempt UUID and optional submission UUID.'
                  : 'The native review context could not be confirmed. Refresh this exact attempt link.'}
            </p>
            <a className={styles.backLink} href="/operator">
              Back to reviews
            </a>
          </section>
        )}
      </StaffShell>
    );
  }
  const queue = await readRaidQueue(getDatabase(), user.authUserId).catch(() => null);
  return (
    <StaffShell
      user={{ displayName: user.displayName, role: user.role === 'admin' ? 'admin' : 'operator' }}
      active={user.role === 'admin' ? 'overview' : 'reviews'}
    >
      {user.role === 'admin' ? <AdminOverview queue={queue} /> : <MentorOverview queue={queue} />}
    </StaffShell>
  );
}
