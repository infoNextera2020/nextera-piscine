import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode, Ref } from 'react';
import type { SubmissionRules, UserRole } from '@nextera/domain';
import type { LearningNode } from '../../lib/learning/types';
import { displayState } from '../../lib/learning/display';
import { ChallengeArtwork, challengeArtworkKey } from './challenge-artwork';
import s from './focused-challenge.module.css';
import { LearningSurface } from './design-exploration';

/** Presentation only. The existing Challenge controller owns intake, polling and access. */
export function FocusedChallenge({
  cohort,
  current,
  rules,
  subject,
  submission,
  history,
  context,
  role,
  notice,
  historyTools,
  historyRef,
  resources,
  hint,
  review,
  account,
  resourcesOpen = false,
  onResourcesChange,
}: {
  cohort: { id: string; name: string; version: string };
  current: Pick<LearningNode, 'key' | 'title' | 'questKey' | 'questTitle' | 'state'>;
  rules: SubmissionRules;
  subject: ReactNode;
  submission: ReactNode;
  history: ReactNode;
  context: LearningNode[];
  role: UserRole;
  notice?: ReactNode;
  historyTools?: ReactNode;
  historyRef?: Ref<HTMLElement>;
  resources?: ReactNode;
  hint?: ReactNode;
  review?: ReactNode;
  account?: ReactNode;
  resourcesOpen?: boolean;
  onResourcesChange?: ((open: boolean) => void) | undefined;
}) {
  const base = '/app/cohorts/' + encodeURIComponent(cohort.id);
  const quest = base + '?quest=' + encodeURIComponent(current.questKey);
  const artwork = challengeArtworkKey(current.key);
  return (
    <LearningSurface page="challenge">
      <div className={s.surface} data-focused-challenge>
        <div className={s.container}>
          <a className={s.skip} href="#focused-challenge-main">
            Skip to main content
          </a>
          <header className={s.topbar}>
            <Link className={s.brand} href="/app" aria-label="01 coding Piscine home">
              <Image src="/branding/01-coding/mark.svg" alt="" width={68} height={68} unoptimized />
            </Link>
            <nav className={s.navigation} aria-label="Learner navigation">
              <Link href={'/app?cohort=' + encodeURIComponent(cohort.id)}>Home</Link>
              <Link href={base}>Journey</Link>
              {role === 'learner' && <Link href={base + '/evidence'}>Evidence</Link>}
              {role !== 'learner' && <Link href="/operator/raids">Team reviews</Link>}
            </nav>
            <div className={s.headerEnd}>
              <span className={s.portal}>Piscine</span>
              {account}
            </div>
          </header>
          <main id="focused-challenge-main" className={s.main} tabIndex={-1}>
            <Link className={s.back} href={quest}>
              <span aria-hidden="true">←</span> Back to quest
            </Link>
            <header className={s.heading} data-illustrated={artwork !== null || undefined}>
              <div className={s.headingCopy}>
                <p className={s.eyebrow}>{current.questTitle}</p>
                <div className={s.titleRow}>
                  <h1>{current.title}</h1>
                  {current.state !== null && (
                    <span className={s.state} data-state={current.state}>
                      {displayState(current.state)}
                    </span>
                  )}
                </div>
                <p className={s.intro}>Read the brief. Build locally. Submit your solution.</p>
              </div>
              {artwork && <ChallengeArtwork key={artwork} figure={artwork} />}
            </header>
            {notice && <div className={s.notice}>{notice}</div>}
            <div className={s.layout}>
              <div className={s.primary}>
                <section className={s.task} aria-labelledby="focused-task-label">
                  <h2 id="focused-task-label" className={s.label}>
                    Your task
                  </h2>
                  <div className={s.subject}>{subject}</div>
                </section>
                <details className={s.disclosure}>
                  <summary>
                    Check your work<span aria-hidden="true">+</span>
                  </summary>
                  <div className={s.disclosureBody}>
                    <ul>
                      <li>Run and test your solution in your own terminal.</li>
                      <li>Check your file and output against the published brief.</li>
                    </ul>
                  </div>
                </details>
                {hint && (
                  <details className={s.disclosure}>
                    <summary>
                      Need a hint?<span aria-hidden="true">+</span>
                    </summary>
                    <div className={s.disclosureBody}>{hint}</div>
                  </details>
                )}
                <div className={s.submission}>{submission}</div>
                <details className={s.disclosure}>
                  <summary>
                    Submission guidance<span aria-hidden="true">+</span>
                  </summary>
                  <div className={s.disclosureBody}>
                    <dl className={s.facts}>
                      <div>
                        <dt>Required files</dt>
                        <dd>{rules.required_files.join(', ')}</dd>
                      </div>
                      <div>
                        <dt>Allowed extensions</dt>
                        <dd>{rules.allowed_extensions.join(', ')}</dd>
                      </div>
                      <div>
                        <dt>Maximum size</dt>
                        <dd>{rules.max_size_kb} KiB</dd>
                      </div>
                    </dl>
                  </div>
                </details>
                <section
                  ref={historyRef}
                  className={s.history}
                  aria-labelledby="focused-history-heading"
                  tabIndex={-1}
                >
                  <div className={s.historyHeading}>
                    <h2 id="focused-history-heading">Submission history</h2>
                    {historyTools}
                  </div>
                  {history}
                </section>
              </div>
              <aside className={s.support} aria-label="Challenge support">
                <p className={s.label}>When you need it</p>
                <details
                  className={s.disclosure}
                  id="focused-resources"
                  open={resourcesOpen}
                  onToggle={(event) => {
                    const open = event.currentTarget.open;
                    if (open !== resourcesOpen) onResourcesChange?.(open);
                  }}
                >
                  <summary>
                    Resources<span aria-hidden="true">+</span>
                  </summary>
                  <div className={s.disclosureBody}>
                    {resources ?? (
                      <p>No separate resources are attached. Start with the published brief.</p>
                    )}
                  </div>
                </details>
                {review && (
                  <details className={s.disclosure}>
                    <summary>
                      Review &amp; understanding<span aria-hidden="true">+</span>
                    </summary>
                    <div className={s.disclosureBody}>{review}</div>
                  </details>
                )}
                <details className={s.disclosure}>
                  <summary>
                    About this exercise<span aria-hidden="true">+</span>
                  </summary>
                  <div className={s.disclosureBody}>
                    <p>{cohort.name}</p>
                    <p>
                      Curriculum version <code>{cohort.version}</code>
                    </p>
                  </div>
                </details>
                <details className={s.disclosure}>
                  <summary>
                    In this quest<span aria-hidden="true">+</span>
                  </summary>
                  <div className={s.disclosureBody}>
                    <ul className={s.context}>
                      {context.map((node) => (
                        <li key={node.key}>
                          {node.href ? (
                            <Link
                              href={node.href}
                              aria-current={node.key === current.key ? 'page' : undefined}
                            >
                              {node.title}
                            </Link>
                          ) : (
                            <span>{node.title}</span>
                          )}
                          <span className={s.contextState}>{node.label}</span>
                        </li>
                      ))}
                    </ul>
                    <Link href={base}>Back to Journey</Link>
                  </div>
                </details>
              </aside>
            </div>
          </main>
        </div>
      </div>
    </LearningSurface>
  );
}
