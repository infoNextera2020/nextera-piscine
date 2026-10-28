'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { LearningModule, LearningNode, LearningOverview } from '../../lib/learning/types';
import { displayState } from '../../lib/learning/display';
import s from './journey.module.css';
import { HeartJourney } from './heart-journey';

type Kind = 'challenge' | 'checkpoint' | 'project';
type Layout = 'list' | 'tree';
const kinds: Kind[] = ['challenge', 'checkpoint', 'project'];
const kindNames = { challenge: 'Challenges', checkpoint: 'Checkpoints', project: 'Projects' };
function Status({ state }: { state: string | null }) {
  return (
    <span className={s.status} data-state={state}>
      {displayState(state)}
    </span>
  );
}

export function JourneyEntry({ empty }: { empty: boolean }) {
  return (
    <header className={s.entry}>
      <p className={s.eyebrow}>01 coding PISCINE / JOURNEY</p>
      <h1>Your journey.</h1>
      <p>
        {empty
          ? 'No active cohort assigned'
          : 'Choose a cohort to explore your curriculum and next steps.'}
      </p>
      {empty && (
        <>
          <p>Enrollment is controlled by your operator.</p>
          <Link className={s.textLink} href="/app">
            Return to Home ↗
          </Link>
        </>
      )}
    </header>
  );
}

export function Roadmap(props: Parameters<typeof QuestRoadmap>[0]) {
  if (!props.questDetail)
    return (
      <HeartJourney
        view={props.view}
        initialModule={props.initialModule}
        initialNode={props.initialNode}
        kind={props.kind}
        base={props.base}
        preview={props.preview}
        cohortName={props.cohortName ?? 'Your cohort'}
        {...(props.version ? { version: props.version } : {})}
      />
    );
  return <QuestRoadmap {...props} />;
}

function QuestRoadmap({
  view,
  initialModule,
  initialNode,
  initialLayout = 'list',
  questDetail = false,
  kind,
  base,
  preview,
  cohortName = 'Your cohort',
  version,
}: {
  view: Pick<LearningOverview, 'nodes' | 'modules' | 'counts'> & {
    current?: LearningNode | null;
    submissions?: LearningOverview['submissions'];
  };
  initialModule: string | null;
  initialNode: string | null;
  initialLayout?: Layout;
  questDetail?: boolean;
  kind: Kind | null;
  base: string;
  preview: boolean;
  cohortName?: string;
  version?: string;
}) {
  const detailsRef = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState({
    quest: initialModule,
    node: initialNode,
    detail: questDetail,
    layout: initialLayout,
    kind,
  });
  useEffect(() => {
    const restore = () => {
      const q = new URLSearchParams(window.location.search);
      const n = view.nodes.find((n) => n.key === q.get('node'));
      const k = q.get('kind');
      setSelection({
        quest: n?.questKey ?? q.get('quest') ?? initialModule,
        node: n?.key ?? null,
        detail: q.has('quest'),
        layout: q.get('layout') === 'tree' ? 'tree' : 'list',
        kind: kinds.includes(k as Kind) ? (k as Kind) : null,
      });
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [view.nodes, initialModule]);
  const quest = view.modules.find((q) => q.key === selection.quest) ?? view.modules[0];
  const node = quest?.nodes.find((n) => n.key === selection.node) ?? null;
  const selected = node ?? quest?.next ?? quest?.nodes[0] ?? null;
  const modules = view.modules
    .map((q) => ({
      ...q,
      nodes: q.nodes.filter((n) => !selection.kind || n.kind === selection.kind),
    }))
    .filter((q) => q.nodes.length);
  function update(patch: Partial<typeof selection>) {
    const next = { ...selection, ...patch };
    if (Object.hasOwn(patch, 'kind')) {
      const candidates = next.detail ? (quest?.nodes ?? []) : view.nodes;
      const target =
        candidates.find((n) => n.key === next.node && (!next.kind || n.kind === next.kind)) ??
        candidates.find((n) => !next.kind || n.kind === next.kind);
      next.node = target?.key ?? null;
      if (!next.detail && target) next.quest = target.questKey;
    }
    setSelection(next);
    const q = new URLSearchParams(window.location.search);
    for (const key of ['quest', 'node', 'layout', 'kind']) q.delete(key);
    if (next.detail && next.quest) q.set('quest', next.quest);
    if (next.node) q.set('node', next.node);
    if (next.layout === 'tree') q.set('layout', 'tree');
    if (next.kind) q.set('kind', next.kind);
    window.history.pushState(null, '', base + (q.size ? '?' + q.toString() : ''));
  }
  function selectNode(item: LearningNode) {
    update({ quest: item.questKey, node: item.key });
    if (
      window.matchMedia(selection.detail ? '(max-width: 1250px)' : '(max-width: 1000px)').matches
    ) {
      requestAnimationFrame(() => {
        detailsRef.current?.focus({ preventScroll: true });
        detailsRef.current?.scrollIntoView({ block: 'start' });
      });
    }
  }
  const detailHref = (key: string) => base + '?quest=' + encodeURIComponent(key);
  return (
    <main className={s.page}>
      <nav className={s.breadcrumb} aria-label="Breadcrumb">
        <Link href="/app">Home</Link>
        <span aria-hidden="true">/</span>
        {selection.detail ? (
          <>
            <Link href={base}>Journey</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{quest?.title ?? 'Quest'}</span>
          </>
        ) : (
          <span aria-current="page">Journey</span>
        )}
      </nav>
      <header className={s.heading}>
        <div>
          <p className={s.eyebrow}>
            {selection.detail ? 'QUEST / ' + cohortName : '01 coding PISCINE / ' + cohortName}
          </p>
          <h1>{selection.detail ? (quest?.title ?? 'Quest unavailable') : 'Your journey.'}</h1>
          <p>
            {selection.detail
              ? 'Explore the brief, requirements, and work inside this quest.'
              : 'Find your place. Understand the next step. Build something that lasts.'}
          </p>
        </div>
        {!preview && (
          <div className={s.total}>
            <strong>
              {view.counts.mastered}
              <span> / {view.counts.total}</span>
            </strong>
            <span>nodes mastered</span>
          </div>
        )}
      </header>
      {preview && (
        <p className={s.notice}>Read-only curriculum preview. No learner progress is implied.</p>
      )}
      {!view.nodes.length ? (
        <section className={s.empty}>
          <h2>No published curriculum</h2>
          <p>There is no published work in this cohort to explore right now.</p>
        </section>
      ) : (
        <>
          <div className={s.toolbar}>
            <div className={s.filters} aria-label="Filter curriculum">
              {[null, ...kinds].map((k) => (
                <button
                  key={k ?? 'all'}
                  type="button"
                  aria-pressed={selection.kind === k}
                  onClick={() => update({ kind: k })}
                >
                  {k ? kindNames[k] : 'All work'}
                </button>
              ))}
            </div>
            {!selection.detail && (
              <div className={s.layout} role="group" aria-label="Journey view">
                <button
                  type="button"
                  aria-pressed={selection.layout === 'list'}
                  onClick={() => update({ layout: 'list' })}
                >
                  <span aria-hidden="true">☷</span> List
                </button>
                <button
                  type="button"
                  aria-pressed={selection.layout === 'tree'}
                  onClick={() => update({ layout: 'tree' })}
                >
                  <span aria-hidden="true">⌘</span> Tree
                </button>
              </div>
            )}
          </div>
          <div className={s.workspace} data-detail={selection.detail}>
            {selection.detail && quest && (
              <aside className={s.siblings} aria-label="Quest exercises">
                <p className={s.eyebrow}>IN THIS QUEST</p>
                <ol>
                  {quest.nodes.map((item, index) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        aria-pressed={selected?.key === item.key}
                        onClick={() => selectNode(item)}
                      >
                        <span
                          className={s.nodeShape}
                          data-kind={item.kind}
                          data-state={item.state}
                          aria-hidden="true"
                        >
                          {item.state === 'mastered' ? '✓' : String(index + 1).padStart(2, '0')}
                        </span>
                        <span>
                          {item.title}
                          <small>{displayState(item.state)}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                <Link className={s.textLink} href={base}>
                  ← All quests
                </Link>
              </aside>
            )}
            <section
              className={s.curriculum}
              aria-label="Curriculum progression"
              data-layout={selection.layout}
            >
              {selection.detail && quest ? (
                <QuestOverview quest={quest} preview={preview} />
              ) : (
                <>
                  <div className={s.legend}>
                    <span>
                      <i data-state="in_progress" />
                      Current work
                    </span>
                    <span>
                      <i data-state="available" />
                      Available
                    </span>
                    <span>
                      <i data-state="mastered" />
                      Mastered
                    </span>
                    <span>
                      <i data-state="locked" />
                      Locked
                    </span>
                  </div>
                  <p className={s.hierarchyNote}>
                    {selection.layout === 'tree'
                      ? 'Quest → work hierarchy. Access requirements appear in the details.'
                      : 'Quests group the published challenges, projects, and checkpoints.'}
                  </p>
                </>
              )}
              {selection.detail ? (
                quest && (
                  <NodeList
                    nodes={quest.nodes.filter((n) => !selection.kind || n.kind === selection.kind)}
                    selected={selected?.key ?? null}
                    current={view.current?.key ?? null}
                    onSelect={selectNode}
                  />
                )
              ) : modules.length ? (
                <ol className={s.questList}>
                  {modules.map((item, index) => (
                    <li key={item.key} className={s.questGroup}>
                      <header>
                        <span className={s.questIndex}>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <Link href={detailHref(item.key)}>
                            <h2>{item.title}</h2>
                          </Link>
                          <p>
                            {item.nodes.length} {item.nodes.length === 1 ? 'item' : 'items'}
                            {!preview && (
                              <>
                                {' '}
                                · {view.modules.find((q) => q.key === item.key)?.mastered ?? 0}{' '}
                                mastered in quest
                              </>
                            )}
                          </p>
                        </div>
                        <Link
                          className={s.questLink}
                          href={detailHref(item.key)}
                          aria-label={'Open quest: ' + item.title}
                        >
                          ↗
                        </Link>
                      </header>
                      <NodeList
                        nodes={item.nodes}
                        selected={selected?.key ?? null}
                        current={view.current?.key ?? null}
                        onSelect={selectNode}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <div className={s.empty}>
                  <h2>
                    No {selection.kind ? kindNames[selection.kind].toLowerCase() : 'work'} here
                  </h2>
                  <p>This cohort has no published work matching the filter.</p>
                  <button type="button" onClick={() => update({ kind: null })}>
                    Show all work
                  </button>
                </div>
              )}
            </section>
            <aside
              className={s.details}
              aria-label="Selected roadmap details"
              id="journey-details"
              ref={detailsRef}
              tabIndex={-1}
            >
              <p className={s.eyebrow}>SELECTED WORK</p>
              {selected ? (
                <>
                  <div className={s.detailMeta}>
                    <span>{selected.kind}</span>
                    <Status state={selected.state} />
                  </div>
                  <h2>{selected.title}</h2>
                  <p className={s.questContext}>{selected.questTitle}</p>
                  <dl>
                    <div>
                      <dt>Access</dt>
                      <dd>
                        {selected.lockedReason ??
                          (preview
                            ? 'Authorized curriculum preview.'
                            : selected.state === 'mastered'
                              ? 'Mastery is recorded for this work.'
                              : selected.href
                                ? 'This work is available to open.'
                                : 'No workspace is available for this item.')}
                      </dd>
                    </div>
                    {selected.prerequisites.length > 0 && (
                      <div>
                        <dt>Prerequisites</dt>
                        <dd>
                          <ul>
                            {selected.prerequisites.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {selected.skills.length > 0 && (
                      <div>
                        <dt>Skills</dt>
                        <dd className={s.skills}>
                          {selected.skills.map((skill) => (
                            <span key={skill}>{skill}</span>
                          ))}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {selected.assessmentState && (
                    <p className={s.notice}>Assessment: {displayState(selected.assessmentState)}</p>
                  )}
                  {selected.href && (
                    <Link className={s.primary} href={selected.href}>
                      {preview
                        ? 'Preview'
                        : selected.state === 'mastered'
                          ? 'Review'
                          : selected.state === 'in_progress'
                            ? 'Continue'
                            : 'Open'}{' '}
                      {selected.kind}
                      <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                  {!selection.detail && (
                    <Link className={s.textLink} href={detailHref(selected.questKey)}>
                      Explore quest ↗
                    </Link>
                  )}
                  <p className={s.detailNote}>
                    {selected.kind === 'checkpoint'
                      ? 'Checkpoint rules and attempt status are shown in its workspace.'
                      : 'Read the brief, work in your own editor, then upload your file from the workspace.'}
                  </p>
                </>
              ) : (
                <p className={s.detailNote}>
                  Select published work to see its access requirements.
                </p>
              )}
            </aside>
          </div>
          <footer className={s.footer}>
            <span>
              {cohortName}
              {version && <> / Curriculum {version}</>}
            </span>
            <span>Progress reflects recorded server state.</span>
          </footer>
        </>
      )}
    </main>
  );
}

function NodeList({
  nodes,
  selected,
  current,
  onSelect,
}: {
  nodes: LearningNode[];
  selected: string | null;
  current: string | null;
  onSelect: (n: LearningNode) => void;
}) {
  return (
    <ol className={s.nodes}>
      {nodes.length ? (
        nodes.map((n) => (
          <li key={n.key} data-selected={n.key === selected} data-state={n.state}>
            <span
              className={s.nodeShape}
              data-kind={n.kind}
              data-state={n.state}
              aria-hidden="true"
            >
              {n.state === 'mastered'
                ? '✓'
                : n.kind === 'checkpoint'
                  ? '◇'
                  : n.kind === 'project'
                    ? '□'
                    : '·'}
            </span>
            <div className={s.nodeSelect}>
              <h3>
                <button
                  type="button"
                  aria-pressed={n.key === selected}
                  aria-controls="journey-details"
                  onClick={() => onSelect(n)}
                >
                  {n.title}
                </button>
              </h3>
              <span>
                {n.kind}
                {n.key === current && <em>Current work</em>}
                {n.key === selected && <em className={s.selectedLabel}>Selected</em>}
              </span>
            </div>
            <Status state={n.state} />
            {n.href && (
              <Link
                className={s.openNode}
                href={n.href}
                aria-label={'Open ' + n.kind + ': ' + n.title}
              >
                ↗
              </Link>
            )}
          </li>
        ))
      ) : (
        <li className={s.emptyCopy}>No work in this quest matches the filter.</li>
      )}
    </ol>
  );
}

function QuestOverview({ quest, preview }: { quest: LearningModule; preview: boolean }) {
  const skills = [...new Set(quest.nodes.flatMap((n) => n.skills))];
  return (
    <section className={s.questOverview} aria-label="Quest overview">
      <p className={s.eyebrow}>QUEST OVERVIEW</p>
      <h2>The work inside.</h2>
      <p>
        {quest.nodes.length} published {quest.nodes.length === 1 ? 'item' : 'items'}
        {!preview && <> · {quest.mastered} mastered</>}. Select an item to see its requirements, or
        open its workspace when access is available.
      </p>
      <div className={s.skills}>
        {skills.map((skill) => (
          <span key={skill}>{skill}</span>
        ))}
      </div>
    </section>
  );
}
