'use client';
import { useId, useState, type ReactNode, type KeyboardEvent } from 'react';
import Link from 'next/link';
import type { NodeKind } from '@nextera/domain';
import type { LearningNode, LearningModule, LearningOverview } from '../../lib/learning/types';
import { displayState, formatMoment } from '../../lib/learning/display';
import { EmptyState, Panel, ProgressBar, ProgressRing, StatusBadge } from './primitives';
import { Icon } from './icon';
import s from './learning.module.css';
type RoadmapView = Pick<LearningOverview, 'nodes' | 'modules' | 'counts'>;
export function Roadmap({
  view,
  initialModule,
  initialNode,
  kind,
  base,
  preview,
}: {
  view: RoadmapView;
  initialModule: string | null;
  initialNode: string | null;
  kind: NodeKind | null;
  base: string;
  preview: boolean;
}) {
  const [selected, setSelected] = useState(initialModule);
  const [nodeKey, setNodeKey] = useState(initialNode);
  const [tab, setTab] = useState('overview');
  const id = useId();
  const selectedQuest = view.modules.find((m) => m.key === selected) ?? view.modules[0];
  const selectedNode = selectedQuest?.nodes.find((n) => n.key === nodeKey) ?? null;
  const c = view.counts;
  function select(m: LearningModule, node: LearningNode | null = null) {
    setSelected(m.key);
    setNodeKey(node?.key ?? null);
    setTab('overview');
  }
  function nodeCard(node: LearningNode, m: LearningModule) {
    return (
      <li key={node.key} className={s.branchCard} data-state={node.assessmentState ?? node.state}>
        <div className={s.branchTitle}>
          <Icon name={node.kind === 'project' ? 'folder' : 'code'} size={19} />
          <h3>
            <button aria-pressed={nodeKey === node.key} onClick={() => select(m, node)}>
              {node.title}
            </button>
          </h3>
        </div>
        <StatusBadge
          state={node.assessmentState ?? node.state}
          label={node.assessmentState ? displayState(node.assessmentState) : node.label}
        />
        {node.lockedReason && <p className={s.lockReason}>{node.lockedReason}</p>}
        {node.href && (
          <Link className={s.textLink} href={node.href}>
            Read {node.title}
            <Icon name="arrow" size={13} />
          </Link>
        )}
      </li>
    );
  }
  function inOrder(m: LearningModule) {
    const parts: ReactNode[] = [];
    let chunk: LearningNode[] = [];
    let ordinal = 0;
    function flush() {
      if (chunk.length) {
        parts.push(
          <ul key={'branches-' + ordinal++} className={s.branchRow}>
            {chunk.map((n) => nodeCard(n, m))}
          </ul>,
        );
        chunk = [];
      }
    }
    for (const node of m.nodes.filter((n) => !kind || n.kind === kind)) {
      if (node.kind !== 'checkpoint') {
        chunk.push(node);
        continue;
      }
      flush();
      parts.push(
        <article
          className={s.gateCard}
          key={node.key}
          data-state={node.assessmentState ?? node.state}
        >
          <span className={s.nodeIcon}>
            <Icon name="gate" size={23} />
          </span>
          <div>
            <p className={s.micro}>CHECKPOINT GATE</p>
            <h3>
              <button onClick={() => select(m, node)} aria-pressed={nodeKey === node.key}>
                {node.title}
              </button>
            </h3>
            <p>Four tasks · 90 minutes · pass 3 of 4</p>
            {node.lockedReason && <p>{node.lockedReason}</p>}
            {node.href && (
              <Link className={s.textLink} href={node.href}>
                Read {node.title}
                <Icon name="arrow" size={13} />
              </Link>
            )}
          </div>
          <StatusBadge
            state={node.assessmentState ?? node.state}
            label={node.assessmentState ? displayState(node.assessmentState) : node.label}
          />
        </article>,
      );
    }
    flush();
    return parts;
  }
  const tabs = [
    { key: 'overview', title: 'Overview' },
    ...(['challenge', 'project', 'checkpoint'] as const)
      .filter((k) => selectedQuest?.nodes.some((n) => n.kind === k))
      .map((k) => ({
        key: k,
        title: k === 'challenge' ? 'Challenges' : k === 'project' ? 'Projects' : 'Checkpoints',
      })),
  ];
  const shown = selectedQuest?.nodes.filter((n) => tab === 'overview' || n.kind === tab) ?? [];
  function tabsKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const current = tabs.findIndex((t) => t.key === tab);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next]!.key);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
  }
  const next = selectedNode ?? selectedQuest?.next;
  const skills = [
    ...new Set(
      (selectedNode ? [selectedNode] : (selectedQuest?.nodes ?? [])).flatMap((n) => n.skills),
    ),
  ];
  return (
    <div className={s.roadmapLayout}>
      <aside className={s.roadmapSummary} aria-label="Roadmap summary">
        {!preview && (
          <Panel title="Overall Progress">
            <ProgressRing done={c.mastered} total={c.total} />
            <div className={s.summaryMetrics}>
              <div>
                <span className={s.metricIcon}>
                  <Icon name="map" />
                </span>
                <span>
                  <b>
                    {c.mastered} / {c.total}
                  </b>
                  <small>Nodes mastered</small>
                </span>
              </div>
              <div>
                <span className={s.metricIcon + ' ' + s.goldIcon}>
                  <Icon name="gate" />
                </span>
                <span>
                  <b>
                    {c.checkpointsPassed} / {c.checkpoints}
                  </b>
                  <small>Checkpoint passes</small>
                </span>
              </div>
              <div>
                <span className={s.metricIcon}>
                  <Icon name="folder" />
                </span>
                <span>
                  <b>{c.projectsActive}</b>
                  <small>Projects in progress</small>
                </span>
              </div>
            </div>
          </Panel>
        )}
        <Panel title="Program Structure">
          <div className={s.summaryMetrics}>
            <div>
              <span className={s.metricIcon}>
                <Icon name="map" />
              </span>
              <span>
                <b>{view.modules.length} Quests</b>
                <small>Build strong foundations</small>
              </span>
            </div>
            <div>
              <span className={s.metricIcon}>
                <Icon name="code" />
              </span>
              <span>
                <b>{c.challenges} Challenges</b>
                <small>Practice through building</small>
              </span>
            </div>
            {c.projects > 0 && (
              <div>
                <span className={s.metricIcon}>
                  <Icon name="folder" />
                </span>
                <span>
                  <b>{c.projects} Projects</b>
                  <small>Apply your skills</small>
                </span>
              </div>
            )}
            <div>
              <span className={s.metricIcon + ' ' + s.goldIcon}>
                <Icon name="gate" />
              </span>
              <span>
                <b>{c.checkpoints} Checkpoints</b>
                <small>Transfer gates</small>
              </span>
            </div>
          </div>
        </Panel>
        <Panel title="Milestones">
          <ul className={s.milestones}>
            {view.nodes
              .filter((n) => n.kind === 'checkpoint')
              .map((n) => (
                <li key={n.key}>
                  <Icon name="gate" size={15} />
                  <button
                    onClick={() =>
                      select(
                        view.modules.find((m) => m.key === n.questKey)!,
                        n,
                      )
                    }
                  >
                    {n.title}
                  </button>
                  <StatusBadge state={n.assessmentState ?? n.state} />
                </li>
              ))}
          </ul>
          {!c.checkpoints && <p className={s.muted}>No checkpoints in this curriculum.</p>}
        </Panel>
        <div className={s.legend} aria-label="Roadmap state legend">
          <span>
            <i data-state="mastered" />
            Mastered
          </span>
          <span>
            <i data-state="in_progress" />
            In progress
          </span>
          <span>
            <i data-state="available" />
            Available
          </span>
          <span>
            <i data-state="locked" />
            Locked
          </span>
        </div>
      </aside>
      <section className={s.roadmapCenter} aria-label="Curriculum progression">
        <div className={s.filterBar}>
          <h2>Program Roadmap</h2>
          <div aria-label="Filter node type">
            {[
              ['', 'All'],
              ['challenge', 'Challenges'],
              ['project', 'Projects'],
              ['checkpoint', 'Checkpoints'],
            ].map(([value, label]) => (
              <Link
                key={label}
                href={base + (value ? '?kind=' + value : '')}
                aria-current={(kind ?? '') === value ? 'true' : undefined}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className={s.roadmapScroll}>
          <div className={s.spine} aria-hidden="true" />
          <p className={s.journeyStart}>
            <Icon name="map" size={13} />
            YOUR LEARNING JOURNEY
          </p>
          {view.modules
            .filter((m) => !kind || m.nodes.some((n) => n.kind === kind))
            .map((m, i) => (
              <section key={m.key} className={s.moduleSection} aria-label={m.title}>
                <button
                  className={s.moduleCard}
                  data-state={m.state}
                  aria-pressed={selected === m.key && !selectedNode}
                  onClick={() => select(m)}
                >
                  <span className={s.nodeIcon}>
                    <Icon
                      name={
                        m.state === 'mastered' ? 'check' : m.state === 'locked' ? 'lock' : 'map'
                      }
                      size={23}
                    />
                  </span>
                  <span className={s.moduleCopy}>
                    <span className={s.micro}>QUEST {String(i + 1).padStart(2, '0')}</span>
                    <strong>{m.title}</strong>
                    <small>{m.nodes.length} curriculum nodes</small>
                    {!preview && (
                      <ProgressBar
                        done={m.mastered}
                        total={m.nodes.length}
                        label={m.title + ' nodes mastered'}
                      />
                    )}
                  </span>
                  <span className={s.moduleMeta}>
                    <StatusBadge state={m.state} />
                    {!preview && (
                      <small>
                        {m.mastered} / {m.nodes.length} mastered
                      </small>
                    )}
                  </span>
                </button>
                {inOrder(m)}
              </section>
            ))}
          {kind && !view.nodes.some((n) => n.kind === kind) && (
            <div className={s.card + ' ' + s.panel}>
              <EmptyState title="No matching nodes">
                This curriculum has no nodes of this type.
              </EmptyState>
            </div>
          )}
        </div>
      </section>
      <aside
        className={s.card + ' ' + s.roadmapDetail}
        aria-label="Selected roadmap details"
        aria-live="polite"
      >
        {selectedQuest ? (
          <>
            <div className={s.detailTop}>
              <StatusBadge
                state={selectedNode?.assessmentState ?? selectedNode?.state ?? selectedQuest.state}
              />
              <p className={s.micro}>
                {selectedNode ? selectedNode.kind.toUpperCase() : 'SELECTED QUEST'}
              </p>
              <h2>{selectedNode?.title ?? selectedQuest.title}</h2>
              <p className={s.description}>
                {selectedNode
                  ? selectedNode.questTitle
                  : selectedQuest.nodes.length + ' nodes to explore, practice, and master.'}
              </p>
              {!preview && (
                <ProgressBar
                  done={selectedQuest.mastered}
                  total={selectedQuest.nodes.length}
                  label="Selected quest nodes mastered"
                />
              )}
            </div>
            <div
              role="tablist"
              aria-label="Quest details"
              className={s.detailTabs}
              onKeyDown={tabsKey}
            >
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  id={id + '-' + t.key}
                  aria-selected={tab === t.key}
                  aria-controls={id + '-panel'}
                  tabIndex={tab === t.key ? 0 : -1}
                  onClick={() => setTab(t.key)}
                >
                  {t.title}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={id + '-panel'} aria-labelledby={id + '-' + tab} tabIndex={0}>
              {selectedNode?.lockedReason && (
                <p className={s.detailLock}>
                  <Icon name="lock" size={16} />
                  {selectedNode.lockedReason}
                </p>
              )}
              {selectedNode?.kind === 'checkpoint' && (
                <div className={s.policyNote}>
                  <Icon name="gate" />
                  <span>
                    4 tasks · 90 minutes
                    <br />
                    <strong>Pass 3 of 4 tasks</strong>
                  </span>
                </div>
              )}
              <ul className={s.detailList}>
                {shown.map((n) => (
                  <li key={n.key}>
                    <button aria-pressed={nodeKey === n.key} onClick={() => setNodeKey(n.key)}>
                      <span className={s.statusDot} data-state={n.assessmentState ?? n.state} />
                      <span>{n.title}</span>
                      <span className={s.muted}>{displayState(n.assessmentState ?? n.state)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!!skills.length && (
                <div className={s.skills} aria-label="Curriculum skills">
                  {skills.map((skill) => (
                    <span key={skill}>{skill}</span>
                  ))}
                </div>
              )}
            </div>
            <div className={s.miniVisual} aria-hidden="true">
              <span />
            </div>
            {next?.href ? (
              <Link className={s.primaryButton} href={next.href}>
                {preview
                  ? 'Preview node'
                  : next.kind === 'checkpoint'
                    ? 'Open checkpoint'
                    : 'Continue learning'}
                <Icon name="arrow" size={15} />
              </Link>
            ) : (
              <p className={s.detailLock}>Complete the required prerequisites to open this node.</p>
            )}
            <div className={s.nextUp}>
              <h3>Quest Progress</h3>
              <div>
                {preview ? (
                  <p>Read-only preview. No learner progress is implied.</p>
                ) : (
                  <>
                    <strong>
                      {selectedQuest.mastered} of {selectedQuest.nodes.length} nodes mastered
                    </strong>
                    <p>
                      {selectedQuest.nodes.filter((n) => n.state === 'in_progress').length} in
                      progress · {selectedQuest.nodes.filter((n) => n.state === 'available').length}{' '}
                      available
                    </p>
                  </>
                )}
                {selectedNode?.masteredAt && (
                  <small>Mastered {formatMoment(selectedNode.masteredAt)}</small>
                )}
              </div>
            </div>
          </>
        ) : (
          <EmptyState title="No curriculum nodes">
            Your roadmap will appear here when available.
          </EmptyState>
        )}
      </aside>
    </div>
  );
}
