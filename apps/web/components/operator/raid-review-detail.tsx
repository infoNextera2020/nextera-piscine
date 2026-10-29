'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RaidView } from '@nextera/domain';
import { RaidHistory } from '../../lib/raids/panel';
import { HairlineIcon } from '../learning/hairline-icon';
import { confirmsSelectedTeam, latestRaidAttempt } from './review-model';
import s from './staff.module.css';

export function StaffRaidReviewDetail({
  cohort,
  node,
  team,
  title,
  initial,
}: {
  cohort: string;
  node: string;
  team: string;
  title: string;
  initial: RaidView | null;
}) {
  const [view, setView] = useState(initial && confirmsSelectedTeam(initial, team) ? initial : null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [accessRemoved, setAccessRemoved] = useState(false);
  const request = useRef<AbortController | null>(null);
  const removeProtected = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setView(null);
    setAccessRemoved(true);
    setBusy(false);
    setMessage(
      'Access to this team could not be confirmed. Protected records and controls are hidden.',
    );
  }, []);
  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const query = new URLSearchParams({ cohort, node, team });
      const response = await fetch('/api/raids?' + query.toString(), {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted || request.current !== controller) return;
      if (response.status === 401 || response.status === 403) {
        removeProtected();
        return;
      }
      if (!response.ok) throw new Error('Unconfirmed read');
      const next = (await response.json()) as RaidView;
      if (
        !next ||
        !Array.isArray(next.attempts) ||
        typeof next.can_review !== 'boolean' ||
        !confirmsSelectedTeam(next, team)
      ) {
        removeProtected();
        return;
      }
      if (!controller.signal.aborted && request.current === controller) {
        setView(next);
        setAccessRemoved(false);
        setMessage('');
      }
    } catch {
      if (!controller.signal.aborted && request.current === controller) {
        setMessage(
          'The current result could not be confirmed. Your feedback is retained. Refresh before reviewing or downloading.',
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }, [cohort, node, team, removeProtected]);

  useEffect(() => {
    if (accessRemoved || !view) return;
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const interval = setInterval(visible, 5000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [accessRemoved, !!view, refresh]);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  const latest = latestRaidAttempt(view?.attempts ?? []);
  const previous = view?.attempts.filter((item) => item.id !== latest?.id) ?? [];
  return (
    <section className={s.detail} aria-labelledby="raid-detail-heading">
      <div className={s.detailHeading}>
        <div>
          <span className={s.eyebrow}>Raid / exact accepted revision</span>
          <h1 id="raid-detail-heading">Review the work.</h1>
          <p>
            {title}
            {view?.team ? ' · ' + view.team.name : ''}
          </p>
        </div>
        <button className={s.outlineButton} disabled={busy} onClick={() => void refresh()}>
          {busy ? 'Refreshing…' : 'Refresh result'} <HairlineIcon name="arrow" />
        </button>
      </div>
      {message && (
        <p className={s.alert} role="alert">
          {message}
        </p>
      )}
      {!view ? (
        <div className={s.unavailable}>
          <h3>{accessRemoved ? 'Team access unavailable' : 'Review detail unavailable'}</h3>
          <p>
            No protected source, history or decision is shown until an authorized read succeeds.
          </p>
        </div>
      ) : (
        <>
          {!view.can_review && (
            <p className={s.note}>
              Read-only owner preview. Only the assigned mentor can download the accepted artifact
              or record its review.
            </p>
          )}
          {latest ? (
            <div className={s.reviewBody} aria-label="Accepted revision and mentor decision">
              <RaidHistory
                attempts={[latest]}
                canReview={view.can_review}
                paused={!!message || busy}
                onReviewed={() => void refresh()}
                onAccessRemoved={removeProtected}
              />
            </div>
          ) : (
            <div className={s.unavailable}>
              <h3>No shared upload yet</h3>
              <p>The accepted artifact and its automated result must exist before mentor review.</p>
            </div>
          )}
          <details className={s.disclosure}>
            <summary>Current team assignment</summary>
            <p>Assigned mentor: {view.team?.mentor}</p>
            <ul className={s.memberList}>
              {view.team?.members.map((member) => (
                <li key={member.id}>{member.displayName}</li>
              ))}
            </ul>
            <p>Each accepted revision retains its own frozen roster.</p>
          </details>
          {previous.length > 0 && (
            <details className={s.disclosure}>
              <summary>Earlier revisions ({previous.length})</summary>
              <RaidHistory
                attempts={previous}
                canReview={view.can_review}
                paused={!!message || busy}
                onAccessRemoved={removeProtected}
              />
            </details>
          )}
          <details className={s.disclosure}>
            <summary>Review criteria</summary>
            <p>
              Inspect the accepted source and its digest against the published project brief.
              Automated PASS comes first; the assigned mentor reviews that exact revision.
            </p>
            <p>
              Approval alone is not a completion receipt. Shared completion must be confirmed from
              the server. A frozen member’s access loss requires an owner decision.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
