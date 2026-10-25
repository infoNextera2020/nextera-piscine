'use client';
import raidStyles from './raid.module.css';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isRequestId } from '@nextera/domain';
import { SubmissionIntents } from '../submissions/retry-intent';
import s from '../../components/learning/challenge.module.css';
export function RaidAssignment() {
  const router = useRouter(),
    pending = useRef(false),
    intents = useRef<SubmissionIntents | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  if (!intents.current) intents.current = new SubmissionIntents(() => sessionStorage);
  return (
    <section className={s.uploadCard + ' ' + raidStyles.controls}>
      <h2>Assign a team and mentor</h2>
      <p className={s.muted}>
        Use provisioned domain user IDs. All three learners must belong to the same cohort.
        Reassigning a member retires their previous team for this Raid; previous accepted records
        stay immutable.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current) return;
          const fields = new FormData(e.currentTarget);
          const cohort = String(fields.get('cohort')),
            node = String(fields.get('node')),
            mentor = String(fields.get('mentor')),
            name = String(fields.get('name')),
            members = [1, 2, 3].map((i) => String(fields.get('member' + i)));
          if (![cohort, mentor, ...members].every(isRequestId) || new Set(members).size !== 3) {
            setMessage('Supply a cohort ID, a mentor ID and exactly three distinct learner IDs.');
            return;
          }
          pending.current = true;
          setBusy(true);
          setMessage('Saving assignment…');
          try {
            const fingerprint = JSON.stringify({ cohort, node, mentor, name, members });
            const digest = Array.from(
              new Uint8Array(
                await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)),
              ),
              (b) => b.toString(16).padStart(2, '0'),
            ).join('');
            const key = 'raid-assignment:' + digest;
            const response = await fetch('/api/raids', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'assign',
                cohort,
                node,
                mentor,
                name,
                members,
                requestId: intents.current!.requestId(key),
              }),
            });
            if (!response.ok) {
              setMessage(
                response.status === 403
                  ? 'This assignment is not authorized.'
                  : response.status === 409
                    ? 'Assignment conflicts with current records. Refresh before retrying.'
                    : 'Assignment could not be confirmed. Retry the same assignment to check its receipt.',
              );
              return;
            }
            const data = (await response.json()) as { id?: string };
            if (!data.id) throw new Error();
            intents.current!.confirm(key);
            setMessage('Team assignment recorded.');
            router.refresh();
          } catch {
            setMessage(
              'Assignment could not be confirmed. Retry the same assignment to check its receipt.',
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <legend>Owner assignment</legend>
          {(
            [
              ['name', 'Team name'],
              ['cohort', 'Cohort ID'],
              ['node', 'Published Raid node key'],
              ['mentor', 'Assigned mentor domain user ID'],
              ['member1', 'Learner 1 domain user ID'],
              ['member2', 'Learner 2 domain user ID'],
              ['member3', 'Learner 3 domain user ID'],
            ] as const
          ).map(([name, label]) => (
            <label key={name}>
              <span className={s.fieldLabel}>{label}</span>
              <input
                name={name}
                required
                autoComplete="off"
                maxLength={100}
                aria-describedby="assignment-message"
              />
            </label>
          ))}
          <button type="submit" className={s.submitButton}>
            {busy ? 'Saving…' : 'Assign team'}
          </button>
        </fieldset>
        <p id="assignment-message" className={s.feedback} role="status">
          {message}
        </p>
      </form>
    </section>
  );
}
