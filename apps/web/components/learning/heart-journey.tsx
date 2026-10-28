'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LearningNode } from '../../lib/learning/types';
import { displayState } from '../../lib/learning/display';
import {
  HEART_ARROWS,
  HEART_HEIGHT,
  HEART_ROUTE,
  HEART_WIDTH,
  heartPosition,
  heartSteps,
  type HeartStep,
  type HeartView,
} from '../../lib/learning/heart-map';
import { HairlineIcon } from './hairline-icon';
import { fitHeartViewport } from '../../lib/learning/heart-viewport';
import s from './heart-journey.module.css';

type Selection = { id: string | null; node: string | null };
export function HeartJourney({
  view,
  initialModule,
  initialNode,
  kind,
  base,
  preview,
  cohortName,
}: {
  view: HeartView;
  initialModule: string | null;
  initialNode: string | null;
  kind: 'challenge' | 'checkpoint' | 'project' | null;
  base: string;
  preview: boolean;
  cohortName: string;
  version?: string;
}) {
  const steps = useMemo(
    () =>
      heartSteps(view).map((step) =>
        preview ? { ...step, state: null, current: false, pending: false } : step,
      ),
    [view, preview],
  );
  const selectNode = (key: string | null) =>
    steps.find(
      (step) =>
        step.nodes.some((n) => n.key === key) &&
        (step.kind === 'quest'
          ? view.nodes.find((n) => n.key === key)?.kind === 'challenge'
          : true),
    );
  const initial =
    selectNode(initialNode) ??
    (kind ? steps.find((step) => step.kind === (kind === 'challenge' ? 'quest' : kind)) : null) ??
    steps.find((step) => step.kind === 'quest' && step.key === initialModule) ??
    steps.find((step) => step.current) ??
    steps[0];
  const [selection, setSelection] = useState<Selection>({
    id: initial?.id ?? null,
    node: initialNode ?? null,
  });
  const [interacted, setInteracted] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(!!initialNode || !!kind);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const ordered = useRef<HTMLDialogElement>(null);
  const orderedTrigger = useRef<HTMLButtonElement>(null);
  const orderedId = useId();
  const details = useRef<HTMLElement>(null);
  const detailId = useId();
  const helpId = useId();
  const selected = steps.find((step) => step.id === selection.id) ?? steps[0];
  const focused = selected?.nodes.find((n) => n.key === selection.node) ?? null;
  useEffect(() => {
    const restore = () => {
      const q = new URLSearchParams(window.location.search);
      const node = q.get('node');
      const step =
        (node
          ? steps.find(
              (item) =>
                item.nodes.some((n) => n.key === node) &&
                (item.kind !== 'quest' ||
                  view.nodes.find((n) => n.key === node)?.kind === 'challenge'),
            )
          : null) ??
        steps.find((item) => item.kind === 'quest' && item.key === q.get('mapQuest')) ??
        initial;
      setSelection({ id: step?.id ?? null, node });
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [steps, initial, view.nodes]); // Restore only from supplied facts and URL metadata.
  useEffect(() => {
    const box = viewport.current,
      map = canvas.current,
      crop = frame.current;
    if (!box || !map || !crop) return;
    const fit = () => {
      const size = fitHeartViewport(box.clientWidth, box.clientHeight);
      if (!size) return;
      crop.style.width = size.frameWidth + 'px';
      crop.style.height = size.frameHeight + 'px';
      map.style.width = size.canvasWidth + 'px';
      map.style.height = size.canvasHeight + 'px';
      map.style.left = size.left + 'px';
      map.style.top = size.top + 'px';
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  function choose(step: HeartStep, node: string | null = null, reveal = true) {
    setSelection({ id: step.id, node });
    setInteracted(true);
    setDetailsOpen(true);
    const q = new URLSearchParams(window.location.search);
    for (const key of ['node', 'quest', 'kind', 'layout', 'mapQuest']) q.delete(key);
    if (step.kind === 'quest' && !node) q.set('mapQuest', step.key);
    else q.set('node', node ?? step.nodes[0]!.key);
    window.history.pushState(null, '', base + '?' + q.toString());
    if (reveal && window.matchMedia('(max-width: 1100px)').matches)
      requestAnimationFrame(() => {
        details.current?.focus({ preventScroll: true });
      });
  }
  function findCurrent() {
    const current = steps.find((step) => step.current);
    if (!current) return;
    choose(current, view.current?.key ?? null, false);
    requestAnimationFrame(() =>
      canvas.current
        ?.querySelector<HTMLElement>('[data-current="true"] [data-step-action]')
        ?.focus({ preventScroll: true }),
    );
  }
  return (
    <main className={s.page} data-journey-fit aria-label={cohortName + ' Journey'}>
      <header className={s.srOnly}>
        <div>
          <p className={s.eyebrow}>WORKSPACE / JOURNEY</p>
          <h1>Piscine</h1>
        </div>
        <span className={s.cohort}>{cohortName}</span>
      </header>
      {preview && (
        <p className={s.previewLabel}>
          Read-only preview<span className={s.srOnly}>. No learner progress is implied.</span>
        </p>
      )}
      {!steps.length ? (
        <section className={s.empty}>
          <h2>No published curriculum</h2>
          <p>There is no published work in this cohort to explore right now.</p>
        </section>
      ) : (
        <>
          <div className={s.mapControls}>
            <button
              ref={orderedTrigger}
              type="button"
              aria-label="Browse published journey steps"
              aria-haspopup="dialog"
              aria-controls={orderedId}
              onClick={() => ordered.current?.showModal()}
            >
              <HairlineIcon name="search" size={24} />
            </button>
            {!preview && view.current && (
              <button type="button" aria-label="Find current work" onClick={findCurrent}>
                <HairlineIcon name="map" size={24} />
              </button>
            )}
          </div>
          <p id={helpId} className={s.srOnly}>
            The whole heart fits the available viewport. The line follows published reading order.
            It does not imply prerequisites. Open a quest or an authorized workspace, inspect locked
            requirements, or use Browse published journey steps for full titles and larger
            navigation targets.
          </p>
          <div
            ref={viewport}
            className={s.mapViewport}
            role="region"
            aria-label="Piscine journey map"
            aria-describedby={helpId}
            tabIndex={0}
          >
            <div ref={frame} className={s.mapFrame}>
              <div ref={canvas} className={s.mapCanvas}>
                <svg
                  className={s.route}
                  viewBox={`0 0 ${HEART_WIDTH} ${HEART_HEIGHT}`}
                  fill="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <polyline
                    points={HEART_ROUTE.map((p) => p.x + ',' + p.y).join(' ')}
                    stroke="#446454"
                    strokeWidth="1.25"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="miter"
                  />
                  {HEART_ARROWS.map((arrow, index) => (
                    <path
                      key={index}
                      d="M-7 -4 0 0-7 4"
                      transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
                      stroke="#57e6ad"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
                <div className={s.start}>
                  <Image
                    src="/branding/01-coding/mark.svg"
                    alt="01 coding"
                    width={220}
                    height={89}
                    unoptimized
                  />
                  <span>START</span>
                </div>
                <ol className={s.mapNodes} aria-label="Published journey steps">
                  {steps.map((step, index) => {
                    const point = heartPosition(index, steps.length);
                    return (
                      <li
                        key={step.id}
                        style={{
                          left: (point.x / HEART_WIDTH) * 100 + '%',
                          top: (point.y / HEART_HEIGHT) * 100 + '%',
                        }}
                        data-side={point.side}
                        data-kind={step.kind}
                        data-state={step.state}
                        data-current={step.current}
                        data-selected={
                          selected?.id === step.id && (!preview || interacted || !!initialNode)
                        }
                        data-pending={step.pending}
                      >
                        <StepAction
                          step={step}
                          base={base}
                          preview={preview}
                          selected={
                            selected?.id === step.id && (!preview || interacted || !!initialNode)
                          }
                          detailId={detailId}
                          onInspect={() => {
                            ordered.current?.close();
                            choose(step);
                          }}
                        >
                          <Marker step={step} />
                          <span className={s.mapLabel} aria-hidden="true">
                            <strong>
                              {kindName(step)} {step.ordinal}
                            </strong>
                            <span>{step.title}</span>
                            {!preview && (
                              <small>
                                {step.current ? 'Current · ' : ''}
                                {displayState(step.state)}
                                {step.pending ? ' · Pending' : ''}
                              </small>
                            )}
                          </span>
                        </StepAction>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </div>
          <details
            className={s.inspector}
            hidden={!interacted && !initialNode && !kind}
            open={detailsOpen}
            onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
          >
            <summary>
              Step details <span>{focused?.title ?? selected?.title}</span>
            </summary>
            <aside
              className={s.selected}
              id={detailId}
              aria-label="Selected roadmap details"
              ref={details}
              tabIndex={-1}
            >
              {selected && (
                <>
                  <div className={s.selectedHeading}>
                    <p className={s.eyebrow}>
                      SELECTED / {kindName(selected)} {selected.ordinal}
                    </p>
                    <h2>{focused?.title ?? selected.title}</h2>
                    <p
                      className={s.status}
                      data-state={preview ? null : (focused?.state ?? selected.state)}
                    >
                      {preview
                        ? 'Read-only preview'
                        : displayState(focused?.state ?? selected.state)}
                      {selected.current && <span>Current work</span>}
                      {selected.pending && <span className={s.pending}>Evaluation pending</span>}
                    </p>
                  </div>
                  <div className={s.selectedCopy}>
                    {focused ? (
                      <NodeFacts node={focused} preview={preview} />
                    ) : selected.kind === 'quest' ? (
                      <>
                        <p>
                          {selected.nodes.length} published{' '}
                          {selected.nodes.length === 1 ? 'item' : 'items'} in this quest. Select a
                          workspace to read its brief and access requirements.
                        </p>
                        <ul className={s.questItems}>
                          {selected.nodes.map((node) => (
                            <li key={node.key}>
                              <button
                                type="button"
                                onClick={() =>
                                  choose(selectNode(node.key) ?? selected, node.key, false)
                                }
                              >
                                {node.title}
                                <span>
                                  {preview ? 'Read-only preview' : displayState(node.state)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <NodeFacts node={selected.nodes[0]!} preview={preview} />
                    )}
                  </div>
                  <div className={s.selectedAction}>
                    {focused?.href ? (
                      <Link className={s.primary} href={focused.href}>
                        {preview
                          ? 'Preview'
                          : focused.state === 'mastered'
                            ? 'Review'
                            : focused.state === 'in_progress'
                              ? 'Continue'
                              : 'Open'}{' '}
                        {focused.kind} ↗
                      </Link>
                    ) : selected.kind === 'quest' ? (
                      <Link
                        className={s.primary}
                        href={base + '?quest=' + encodeURIComponent(selected.key)}
                      >
                        View quest ↗
                      </Link>
                    ) : selected.nodes[0]?.href ? (
                      <Link className={s.primary} href={selected.nodes[0].href}>
                        {preview ? 'Preview' : 'Open'} {selected.kind} ↗
                      </Link>
                    ) : (
                      <p>Workspace access is currently locked.</p>
                    )}
                    {!preview && view.current && (
                      <button type="button" className={s.textButton} onClick={findCurrent}>
                        Find current work ↗
                      </button>
                    )}
                  </div>
                </>
              )}
            </aside>
          </details>
          <dialog
            ref={ordered}
            id={orderedId}
            className={`${s.ordered} ${s.orderedDialog}`}
            aria-labelledby={orderedId + '-title'}
            onClose={() => orderedTrigger.current?.focus({ preventScroll: true })}
          >
            <header>
              <h2 id={orderedId + '-title'}>Published journey steps</h2>
              <button
                type="button"
                aria-label="Close journey steps"
                onClick={() => ordered.current?.close()}
              >
                <HairlineIcon name="close" size={23} />
              </button>
            </header>
            <ol>
              {steps.map((step) => (
                <li key={step.id}>
                  <StepAction
                    step={step}
                    base={base}
                    preview={preview}
                    selected={selected?.id === step.id && (!preview || interacted || !!initialNode)}
                    detailId={detailId}
                    onInspect={() => {
                      ordered.current?.close();
                      choose(step);
                    }}
                  >
                    <Marker step={step} />
                    <span>
                      <strong>
                        {kindName(step)} {step.ordinal}
                      </strong>
                      <span>{step.title}</span>
                      {!preview && (
                        <small>
                          {displayState(step.state)}
                          {step.current ? ' · Current' : ''}
                          {step.pending ? ' · Pending' : ''}
                        </small>
                      )}
                    </span>
                    <span aria-hidden="true">↗</span>
                  </StepAction>
                </li>
              ))}
            </ol>
            <footer className={s.footer}>
              <div className={s.key}>
                <span>MAP KEY</span>
                <span>
                  <i className={s.questKey} />
                  Quest
                </span>
                <span>
                  <i className={s.checkpointKey} />
                  Checkpoint
                </span>
                <span>
                  <svg className={s.projectKey} viewBox="0 0 24 20" fill="none" aria-hidden="true">
                    <path d="M6 1h12l5 9-5 9H6L1 10Z" />
                  </svg>
                  Project
                </span>
              </div>
            </footer>
          </dialog>
        </>
      )}
    </main>
  );
}

function StepAction({
  step,
  base,
  preview,
  selected,
  detailId,
  onInspect,
  children,
}: {
  step: HeartStep;
  base: string;
  preview: boolean;
  selected: boolean;
  detailId: string;
  onInspect: () => void;
  children: ReactNode;
}) {
  const href =
    step.kind === 'quest' ? base + '?quest=' + encodeURIComponent(step.key) : step.nodes[0]?.href;
  const label = `${kindName(step)} ${step.ordinal}: ${step.title}. ${preview ? 'Read-only preview' : displayState(step.state)}${step.current ? '. Current work' : ''}${step.pending ? '. Evaluation pending' : ''}`;
  return href ? (
    <Link
      data-step-action
      href={href}
      aria-label={label}
      title={label}
      aria-current={step.current ? 'step' : undefined}
    >
      {children}
    </Link>
  ) : (
    <button
      data-step-action
      type="button"
      aria-label={label + '. Show requirements'}
      aria-pressed={selected}
      aria-controls={detailId}
      onClick={onInspect}
    >
      {children}
    </button>
  );
}

function kindName(step: HeartStep) {
  return step.kind === 'quest' ? 'Quest' : step.kind === 'checkpoint' ? 'Checkpoint' : 'Project';
}
function NodeFacts({ node, preview }: { node: LearningNode; preview: boolean }) {
  return (
    <>
      <p>
        {preview
          ? 'Authorized curriculum preview. No learner progress is implied.'
          : (node.lockedReason ??
            (node.state === 'mastered'
              ? 'Mastery is recorded for this work.'
              : node.href
                ? 'This workspace is available to open.'
                : 'No workspace is currently available for this item.'))}
      </p>
      {node.prerequisites.length > 0 && (
        <div className={s.requirements}>
          <h3>Prerequisites</h3>
          <ul>
            {node.prerequisites.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </div>
      )}
      {!preview && node.assessmentState && <p>Assessment: {displayState(node.assessmentState)}</p>}
    </>
  );
}
function Marker({ step }: { step: HeartStep }) {
  return (
    <svg className={s.marker} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      {step.kind === 'checkpoint' ? (
        <>
          <circle cx="24" cy="24" r="20" />
          <circle className={s.innerRing} cx="24" cy="24" r="15" />
        </>
      ) : step.kind === 'project' ? (
        <path d="M13 6h22l11 18-11 18H13L2 24Z" />
      ) : (
        <rect x="7" y="7" width="34" height="34" rx="3" />
      )}
      <text x="24" y="28" textAnchor="middle">
        {step.state === 'mastered'
          ? '✓'
          : (step.kind === 'quest' ? '' : step.kind === 'checkpoint' ? 'C' : 'P') + step.ordinal}
      </text>
      {step.pending && <circle className={s.pendingDot} cx="40" cy="7" r="4" />}
    </svg>
  );
}
