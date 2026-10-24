import Link from 'next/link';
import type { SubmissionRules } from '@nextera/domain';
import type { LearningNode } from '../../lib/learning/types';
import { displayState } from '../../lib/learning/display';
import { Icon } from './icon';
import s from './challenge.module.css';

export function ChallengeHeading({
  cohort,
  current,
  rules,
}: {
  cohort: { id: string; name: string; version: string };
  current: Pick<LearningNode, 'title' | 'questKey' | 'questTitle' | 'kind' | 'state'>;
  rules: SubmissionRules;
}) {
  return (
    <>
      <nav className={s.breadcrumbs} aria-label="Breadcrumb">
        <Link href={'/app/cohorts/' + cohort.id}>Journey</Link>
        <span aria-hidden="true">/</span>
        <Link href={'/app/cohorts/' + cohort.id + '?quest=' + encodeURIComponent(current.questKey)}>
          {current.questTitle}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{current.title}</span>
      </nav>
      <header className={s.heading}>
        <p className={s.eyebrow}>
          {current.questTitle}
          <span>· {current.kind === 'project' ? 'Project' : 'Challenge'}</span>
        </p>
        <div className={s.titleRow}>
          <h1>{current.title}</h1>
          {current.state !== null && (
            <span className={s.state} data-state={current.state}>
              {displayState(current.state)}
            </span>
          )}
        </div>
        <p className={s.subtitle}>Read the brief. Build locally. Submit your solution.</p>
      </header>
      <div className={s.briefNotice}>
        <Icon name="code" size={17} />
        <span>
          Required file <code>{rules.required_files.join(', ')}</code> · {rules.max_size_kb} KiB
          maximum
        </span>
        <details>
          <summary>Curriculum details</summary>
          <div className={s.technical}>
            <span>{cohort.name}</span>
            <code>{cohort.version}</code>
          </div>
        </details>
      </div>
    </>
  );
}
