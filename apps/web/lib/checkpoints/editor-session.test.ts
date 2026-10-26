import { describe, expect, it } from 'vitest';
import { beginOfficialSubmit, failOfficialSubmit, acceptOfficialSubmit } from './editor-execution';
import {
  captureSource,
  editorActionBlock,
  sameEditorScope,
  selectExamQuestion,
  snapshotBytes,
  type EditorScope,
  type EditorWindow,
  type VisibleRunLimits,
} from './editor-contract';
import {
  acknowledgeDraftSave,
  beginDraftSave,
  conflictDraftSave,
  createQuestionDraft,
  draftSaveStatus,
  editQuestionDraft,
  failDraftSave,
  inspectOfflineDraft,
  prepareOfflineDraft,
  resolveDraftConflict,
} from './editor-drafts';
import {
  beginVisibleRun,
  completeVisibleRun,
  failVisibleRun,
  prepareOfficialSubmit,
  visibleRunIsStale,
} from './editor-execution';

// Deliberately test-only values. No production policy defaults are chosen by this module.
const scope: EditorScope = {
  learnerId: 'learner-a',
  cohortId: 'cohort-a',
  attemptId: 'attempt-a',
  taskKey: 'task-a',
  definitionDigest: 'definition-a',
};
const id = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';
const limits: VisibleRunLimits = {
  timeoutMs: 1000,
  memoryMb: 64,
  outputBytes: 100,
  sourceBytes: 1024,
  requestsPerWindow: 2,
  windowMs: 10000,
  concurrency: 1,
};
function window(patch: Partial<EditorWindow> = {}): EditorWindow {
  return {
    scope,
    access: 'confirmed',
    attempt: 'active',
    serverNow: '2026-10-26T10:00:00Z',
    deadline: '2026-10-26T11:00:00Z',
    capabilities: {
      draftsV1: true,
      officialSubmit: true,
      visibleRun: {
        visibility: 'visible_examples',
        graded: false,
        consumesGradedAttempts: false,
        limits,
      },
    },
    ...patch,
  };
}
const draft = () => editQuestionDraft(createQuestionDraft(scope), 'package main\r\n// café\n');
function saving() {
  const result = beginDraftSave(draft(), window(), id);
  if (!result.request) throw new Error('Test setup failed');
  return result;
}

describe('Checkpoint editor capability boundary', () => {
  it.each(['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest'] as const)(
    'rejects a different %s for all mutations',
    (key) => {
      const other = { ...scope, [key]: 'different' };
      expect(sameEditorScope(scope, other)).toBe(false);
      for (const action of ['save', 'run', 'submit'] as const)
        expect(editorActionBlock(scope, window({ scope: other }), action)).toBe('scope_mismatch');
    },
  );
  it.each(['session_expired', 'removed', 'unknown'] as const)(
    'blocks %s without dropping a local in-memory draft',
    (access) => {
      const current = draft();
      expect(beginDraftSave(current, window({ access }), id)).toEqual({
        draft: current,
        blocked: access,
      });
      expect(prepareOfficialSubmit(current, window({ access }), id, 'answer.go', 1024)).toEqual({
        blocked: access,
      });
      expect(
        beginVisibleRun({ kind: 'idle' }, current, window({ access }), id, 'answer.go').blocked,
      ).toBe(access);
    },
  );
  it.each([
    [{ attempt: 'closed' }, 'closed'],
    [{ serverNow: '2026-10-26T11:00:00Z' }, 'expired'],
    [{ serverNow: '2026-10-26T11:01:00Z' }, 'expired'],
    [{ serverNow: 'invalid' }, 'clock_unavailable'],
    [{ deadline: 'invalid' }, 'clock_unavailable'],
  ] as const)('does not extend time or auto-submit on %o', (patch, expected) => {
    for (const action of ['save', 'run', 'submit'] as const)
      expect(editorActionBlock(scope, window(patch), action)).toBe(expected);
  });
  it('fails closed when draft/Run/editor Submit capabilities are absent', () => {
    const noBackend = window({
      capabilities: { draftsV1: false, officialSubmit: false, visibleRun: null },
    });
    for (const action of ['save', 'run', 'submit'] as const)
      expect(editorActionBlock(scope, noBackend, action)).toBe('capability_unavailable');
  });
  it.each([
    'timeoutMs',
    'memoryMb',
    'outputBytes',
    'sourceBytes',
    'requestsPerWindow',
    'windowMs',
    'concurrency',
  ] as const)('requires an explicit positive Run limit for %s', (key) => {
    const context = window({
      capabilities: {
        ...window().capabilities,
        visibleRun: { ...window().capabilities.visibleRun!, limits: { ...limits, [key]: 0 } },
      },
    });
    expect(editorActionBlock(scope, context, 'run')).toBe('capability_unavailable');
  });
  it('rejects hidden/graded Run semantics even if forced into a runtime response', () => {
    for (const run of [
      { visibility: 'hidden' },
      { graded: true },
      { consumesGradedAttempts: true },
    ]) {
      const current = window();
      const bad = {
        ...current,
        capabilities: {
          ...current.capabilities,
          visibleRun: { ...current.capabilities.visibleRun, ...run },
        },
      } as EditorWindow;
      expect(editorActionBlock(scope, bad, 'run')).toBe('capability_unavailable');
    }
  });
});

describe('Per-question drafts and acknowledged autosave', () => {
  it('freely selects any supplied question without requiring a previous pass or losing drafts', () => {
    const drafts = {
      a: draft(),
      b: editQuestionDraft(createQuestionDraft({ ...scope, taskKey: 'b' }), 'second'),
    };
    const state = { taskKeys: ['a', 'b', 'c'], selectedTaskKey: 'a', drafts };
    const selected = selectExamQuestion(state, 'c');
    expect(selected.selectedTaskKey).toBe('c');
    expect(selected.drafts).toBe(drafts);
    expect(selectExamQuestion(selected, 'unknown')).toBe(selected);
    expect(
      selectExamQuestion({ ...state, taskKeys: [], selectedTaskKey: null }, 'b').selectedTaskKey,
    ).toBeNull();
  });
  it('does not call an unsaved or failed draft saved', () => {
    expect(draftSaveStatus(draft())).toBe('unsaved');
    const result = saving();
    expect(draftSaveStatus(result.draft)).toBe('saving');
    expect(draftSaveStatus(failDraftSave(result.draft, id, 'network'))).toBe('failed');
    const ack = acknowledgeDraftSave(result.draft, { scope, requestId: id, version: 1 });
    expect(draftSaveStatus(ack)).toBe('saved');
    expect(beginDraftSave(ack, window(), id2).blocked).toBe('already_saved');
  });
  it('keeps a newer edit dirty when an older save acknowledgement arrives', () => {
    const result = saving();
    const edited = editQuestionDraft(result.draft, 'newer');
    const ack = acknowledgeDraftSave(edited, { scope, requestId: id, version: 1 });
    expect(ack.source).toBe('newer');
    expect(draftSaveStatus(ack)).toBe('unsaved');
    const next = beginDraftSave(ack, window(), id2);
    expect(next.request).toMatchObject({ source: 'newer', baseVersion: 1, requestId: id2 });
  });
  it('reconciles an uncertain save using the original bytes and ID before sending a later edit', () => {
    const result = saving();
    const failed = failDraftSave(result.draft, id, 'network');
    const edited = editQuestionDraft(failed, 'later edit');
    const retry = beginDraftSave(edited, window(), id2);
    expect(retry.request).toBe(result.request);
    expect(retry.request?.source).not.toBe(edited.source);
    expect(beginDraftSave(retry.draft, window(), id2).blocked).toBe('save_pending');
  });
  it('ignores stale, foreign and invalid acknowledgements', () => {
    const current = saving().draft;
    for (const ack of [
      { scope, requestId: id2, version: 1 },
      { scope: { ...scope, taskKey: 'b' }, requestId: id, version: 1 },
      { scope, requestId: id, version: 0 },
      { scope, requestId: id, version: NaN },
    ])
      expect(acknowledgeDraftSave(current, ack)).toBe(current);
    expect(failDraftSave(current, id2, 'network')).toBe(current);
  });
  it('retains both sides of a conflict and requires an explicit choice', () => {
    const current = saving().draft;
    const conflict = conflictDraftSave(current, {
      scope,
      requestId: id,
      source: 'remote edit',
      version: 2,
    });
    expect(conflict.source).toBe(current.source);
    expect(draftSaveStatus(conflict)).toBe('conflict');
    expect(beginDraftSave(conflict, window(), id2).blocked).toBe('conflict');
    expect(acknowledgeDraftSave(conflict, { scope, requestId: id, version: 1 })).toBe(conflict);
    expect(
      conflictDraftSave(conflict, { scope, requestId: id, source: 'stale remote', version: 1 }),
    ).toBe(conflict);
    const kept = resolveDraftConflict(conflict, 'keep_local');
    expect(kept.source).toBe(current.source);
    expect(draftSaveStatus(kept)).toBe('unsaved');
    expect(beginDraftSave(kept, window(), id2).request?.baseVersion).toBe(2);
    const server = resolveDraftConflict(conflict, 'use_server');
    expect(server.source).toBe('remote edit');
    expect(draftSaveStatus(server)).toBe('saved');
  });
});

describe('Temporary same-device recovery envelope', () => {
  it('requires explicit retention and never extends beyond the attempt deadline', () => {
    expect(prepareOfflineDraft(draft(), window(), 0)).toBeNull();
    expect(prepareOfflineDraft(draft(), window(), NaN)).toBeNull();
    const envelope = prepareOfflineDraft(draft(), window(), 7200000)!;
    expect(envelope.expiresAt).toBe('2026-10-26T11:00:00.000Z');
    expect(Object.keys(envelope).sort()).toEqual([
      'baseVersion',
      'expiresAt',
      'schema',
      'scope',
      'source',
    ]);
  });
  it('offers restore without writing or submitting, and exposes divergent versions as a conflict', () => {
    const envelope = prepareOfflineDraft(draft(), window(), 10000)!;
    expect(inspectOfflineDraft(envelope, window(), { source: '', version: 0 })).toEqual({
      kind: 'restore_available',
      source: draft().source,
    });
    expect(inspectOfflineDraft(envelope, window(), { source: 'remote', version: 1 })).toEqual({
      kind: 'conflict',
      local: draft().source,
      remote: 'remote',
    });
    expect(inspectOfflineDraft(envelope, window(), { source: draft().source, version: 1 })).toEqual(
      { kind: 'already_synced' },
    );
  });
  it('does not replay recovery after local expiry, session expiry, access removal or a different identity/attempt', () => {
    const envelope = prepareOfflineDraft(draft(), window(), 10000)!;
    expect(
      inspectOfflineDraft(envelope, window({ serverNow: '2026-10-26T10:00:10Z' }), {
        source: '',
        version: 0,
      }).kind,
    ).toBe('blocked');
    for (const current of [
      window({ access: 'session_expired' }),
      window({ access: 'removed' }),
      window({ scope: { ...scope, learnerId: 'b' } }),
      window({ scope: { ...scope, attemptId: 'b' } }),
    ])
      expect(inspectOfflineDraft(envelope, current, { source: '', version: 0 }).kind).toBe(
        'blocked',
      );
  });
});

describe('Run and official immutable source snapshots', () => {
  it('captures exact UTF-8 bytes and does not expose a mutable transport buffer', () => {
    const current = draft();
    const snapshot = captureSource(scope, current.source, id, 'answer.go', 1024);
    expect(snapshotBytes(snapshot)).toEqual(new TextEncoder().encode(current.source));
    const bytes = snapshotBytes(snapshot);
    bytes.fill(0);
    expect(snapshotBytes(snapshot)[0]).toBe(112);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.scope)).toBe(true);
    expect(() => captureSource(scope, 'é', id, 'answer.go', 1)).toThrow('EDITOR_SOURCE_SIZE');
    expect(() => captureSource(scope, 'x', id, '../answer.go', 100)).toThrow('EDITOR_FILENAME');
  });
  it('keeps official snapshots independent of unsaved edits and Run output', () => {
    const current = draft();
    const official = prepareOfficialSubmit(current, window(), id, 'answer.go', 1024).snapshot!;
    const edited = editQuestionDraft(current, 'later');
    expect(official.source).toBe(current.source);
    expect(official.source).not.toBe(edited.source);
    const run = beginVisibleRun({ kind: 'idle' }, current, window(), id2, 'answer.go');
    expect(run.request?.requestId).not.toBe(official.requestId);
    expect(current.save.kind).toBe('idle');
    expect(run).not.toHaveProperty('grade');
    expect(run).not.toHaveProperty('gradedAttempts');
  });
  it('allows only one pending Run and ignores late/foreign replies', () => {
    const pending = beginVisibleRun({ kind: 'idle' }, draft(), window(), id, 'answer.go').run;
    expect(beginVisibleRun(pending, draft(), window(), id2, 'answer.go').blocked).toBe(
      'run_pending',
    );
    for (const response of [
      { scope, requestId: id2 },
      { scope: { ...scope, taskKey: 'b' }, requestId: id },
    ])
      expect(completeVisibleRun(pending, { ...response, state: 'completed', output: 'ok' })).toBe(
        pending,
      );
  });
  it('keeps uncertain Run retries on the original source intent', () => {
    const first = beginVisibleRun({ kind: 'idle' }, draft(), window(), id, 'answer.go');
    const uncertain = failVisibleRun(first.run, id);
    expect(uncertain.kind).toBe('uncertain');
    const retry = beginVisibleRun(
      uncertain,
      editQuestionDraft(draft(), 'newer'),
      window(),
      id2,
      'answer.go',
    );
    expect(retry.request).toBe(first.request);
    expect(visibleRunIsStale(retry.run, editQuestionDraft(draft(), 'newer'))).toBe(true);
  });
  it.each([
    'completed',
    'compile_error',
    'runtime_error',
    'timeout',
    'output_limit',
    'system_error',
  ] as const)(
    'keeps %s output out of official history and marks it stale after editing',
    (state) => {
      const current = draft();
      const pending = beginVisibleRun({ kind: 'idle' }, current, window(), id, 'answer.go').run;
      const complete = completeVisibleRun(pending, {
        scope,
        requestId: id,
        state,
        output: 'visible output',
      });
      expect(complete).toMatchObject({ kind: 'complete', state, output: 'visible output' });
      expect(visibleRunIsStale(complete, current)).toBe(false);
      expect(visibleRunIsStale(complete, editQuestionDraft(current, 'newer'))).toBe(true);
      expect(complete).not.toHaveProperty('mastery');
      expect(complete).not.toHaveProperty('submissionHistory');
    },
  );
  it('rejects oversized Run responses rather than retaining unbounded output', () => {
    const pending = beginVisibleRun({ kind: 'idle' }, draft(), window(), id, 'answer.go').run;
    expect(
      completeVisibleRun(pending, {
        scope,
        requestId: id,
        state: 'completed',
        output: 'x'.repeat(101),
      }),
    ).toMatchObject({ kind: 'unavailable' });
  });
});

describe('Official submission uncertainty and deliberate revision', () => {
  it('retries an uncertain upload with the original snapshot and intent after editing', () => {
    const current = draft();
    const first = beginOfficialSubmit({ kind: 'idle' }, current, window(), id, 'answer.go', 1024);
    const uncertain = failOfficialSubmit(first.submission, id);
    const retry = beginOfficialSubmit(
      uncertain,
      editQuestionDraft(current, 'new edit'),
      window(),
      id2,
      'answer.go',
      1024,
    );
    expect(retry.request).toBe(first.request);
    expect(
      beginOfficialSubmit(retry.submission, current, window(), id2, 'answer.go', 1024).blocked,
    ).toBe('submit_pending');
    expect(first.request?.source).toBe(current.source);
  });
  it('records only a matching server acceptance and requires a new intent for a deliberate resubmission', () => {
    const first = beginOfficialSubmit({ kind: 'idle' }, draft(), window(), id, 'answer.go', 1024);
    const accepted = acceptOfficialSubmit(first.submission, {
      scope,
      requestId: id,
      receiptId: id2,
    });
    expect(accepted).toMatchObject({ kind: 'accepted', receiptId: id2 });
    expect(accepted).not.toHaveProperty('grade');
    expect(accepted).not.toHaveProperty('mastery');
    expect(beginOfficialSubmit(accepted, draft(), window(), id, 'answer.go', 1024).blocked).toBe(
      'new_intent_required',
    );
    expect(
      beginOfficialSubmit(
        accepted,
        editQuestionDraft(draft(), 'revision'),
        window(),
        id2,
        'answer.go',
        1024,
      ).request?.source,
    ).toBe('revision');
    expect(acceptOfficialSubmit(accepted, { scope, requestId: id, receiptId: id2 })).toBe(accepted);
  });
  it('ignores foreign/invalid acknowledgements without discarding the unresolved source', () => {
    const pending = beginOfficialSubmit(
      { kind: 'idle' },
      draft(),
      window(),
      id,
      'answer.go',
      1024,
    ).submission;
    for (const response of [
      { scope: { ...scope, attemptId: 'b' }, requestId: id, receiptId: id2 },
      { scope, requestId: id2, receiptId: id2 },
      { scope, requestId: id, receiptId: 'bad' },
    ])
      expect(acceptOfficialSubmit(pending, response)).toBe(pending);
  });
  it('blocks new POST retries at expiry while preserving an earlier accepted receipt for reconciliation', () => {
    const first = beginOfficialSubmit({ kind: 'idle' }, draft(), window(), id, 'answer.go', 1024);
    const uncertain = failOfficialSubmit(first.submission, id);
    expect(
      beginOfficialSubmit(
        uncertain,
        draft(),
        window({ serverNow: window().deadline }),
        id2,
        'answer.go',
        1024,
      ).blocked,
    ).toBe('expired');
    expect(acceptOfficialSubmit(uncertain, { scope, requestId: id, receiptId: id2 }).kind).toBe(
      'accepted',
    );
  });
  it('never treats an older server recovery version as a saved draft, even with matching text', () => {
    const current = createQuestionDraft(scope, { source: 'saved', version: 5 });
    const local = prepareOfflineDraft(current, window(), 10000)!;
    expect(inspectOfflineDraft(local, window(), { source: 'saved', version: 4 })).toEqual({
      kind: 'blocked',
      reason: 'stale_server_version',
    });
  });
});

describe('Execution intent scope isolation', () => {
  it('does not replay another learner/question/attempt Run or Submit intent', () => {
    const pendingRun = beginVisibleRun({ kind: 'idle' }, draft(), window(), id, 'answer.go').run;
    const uncertainRun = failVisibleRun(pendingRun, id);
    const pendingSubmit = beginOfficialSubmit(
      { kind: 'idle' },
      draft(),
      window(),
      id,
      'answer.go',
      1024,
    ).submission;
    const uncertainSubmit = failOfficialSubmit(pendingSubmit, id);
    for (const key of ['learnerId', 'taskKey', 'attemptId'] as const) {
      const other = { ...scope, [key]: 'different' };
      const current = editQuestionDraft(createQuestionDraft(other), 'other source');
      expect(
        beginVisibleRun(uncertainRun, current, window({ scope: other }), id2, 'answer.go').blocked,
      ).toBe('scope_mismatch');
      expect(
        beginOfficialSubmit(
          uncertainSubmit,
          current,
          window({ scope: other }),
          id2,
          'answer.go',
          1024,
        ).blocked,
      ).toBe('scope_mismatch');
    }
  });
  it('requires a fresh intent for a deliberate new Run after a completed one', () => {
    const pending = beginVisibleRun({ kind: 'idle' }, draft(), window(), id, 'answer.go').run;
    const complete = completeVisibleRun(pending, {
      scope,
      requestId: id,
      state: 'completed',
      output: 'ok',
    });
    expect(
      beginVisibleRun(complete, editQuestionDraft(draft(), 'changed'), window(), id, 'answer.go')
        .blocked,
    ).toBe('new_intent_required');
    expect(beginVisibleRun(complete, draft(), window(), id2, 'answer.go').request?.requestId).toBe(
      id2,
    );
  });
});

it('fails closed on a missing capability manifest and rejects control characters in filenames', () => {
  const missing = window({ capabilities: undefined as never });
  for (const action of ['save', 'run', 'submit'] as const)
    expect(editorActionBlock(scope, missing, action)).toBe('capability_unavailable');
  expect(() =>
    captureSource(scope, 'source', id, 'bad' + String.fromCharCode(0) + '.go', 1024),
  ).toThrow('EDITOR_FILENAME');
});
