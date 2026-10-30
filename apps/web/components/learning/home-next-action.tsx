import Link from 'next/link';
import type { LearningOverview } from '../../lib/learning/types';
import { displayState } from '../../lib/learning/display';
import { HairlineIcon } from './hairline-icon';
import s from './home.module.css';

export function HomeNextAction({
  name,
  cohort,
  view,
}: {
  name: string;
  cohort: { id: string; name: string };
  view: Pick<LearningOverview, 'current' | 'currentDescription' | 'nodes'>;
}) {
  const empty = view.nodes.length === 0;
  const current = empty ? null : view.current;
  const action =
    current?.href && (current.state === 'available' || current.state === 'in_progress')
      ? current
      : null;
  const continuing = action?.state === 'in_progress';
  return (
    <section className={s.next} aria-labelledby="home-next-title" data-home-next>
      <div className={s.nextTop}>
        <p className={s.eyebrow}>{action ? `Current ${action.kind}` : 'Your next step'}</p>
        <span className={s.state} data-state={action?.state ?? undefined}>
          {action
            ? displayState(action.state)
            : empty
              ? 'No published curriculum'
              : 'No actionable work'}
        </span>
      </div>
      <div className={s.nextBody}>
        <div>
          <h2 id="home-next-title">
            {action
              ? action.title
              : empty
                ? 'No published work to show.'
                : 'Take a look at your journey.'}
          </h2>
          {action && <p className={s.questContext}>{action.questTitle}</p>}
          <p className={s.description}>
            {empty
              ? 'There is no published work in this cohort to open right now.'
              : !action
                ? 'No work is ready to open right now. Review your recorded progress and access requirements in Journey.'
                : (view.currentDescription ??
                  (action.kind === 'checkpoint'
                    ? 'Review the checkpoint requirements and attempt status before starting.'
                    : 'Read the brief, build in your own editor and terminal, then upload your source file from the challenge.'))}
          </p>
        </div>
      </div>
      <p className={s.editorNote}>
        <HairlineIcon name={action?.kind === 'checkpoint' ? 'gate' : 'code'} size={28} />
        <span>
          {action
            ? action.kind === 'checkpoint'
              ? 'Review the checkpoint requirements before starting.'
              : 'Work in your own editor and terminal.'
            : `${name.trim().split(/\s+/)[0] || name}, your recorded work stays in Journey.`}
        </span>
      </p>
      <div className={s.nextActions} data-actionable={!!action}>
        <Link
          className={s.primary}
          data-press-feedback="primary"
          href={action?.href ?? '/app/cohorts/' + encodeURIComponent(cohort.id)}
        >
          <span>
            {action ? `${continuing ? 'Continue' : 'Open'} ${action.kind}` : 'View journey'}
          </span>
          <HairlineIcon name="arrow" size={25} />
        </Link>
      </div>
    </section>
  );
}
