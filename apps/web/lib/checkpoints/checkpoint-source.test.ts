import { describe, expect, it, vi } from 'vitest';
import { SubmissionIntents } from '../submissions/retry-intent';
import {
  acceptQuestion,
  captureCheckpointSource,
  editQuestion,
  hasUnsubmittedDrafts,
  identifyCheckpointSource,
  questionDraft,
  sendCheckpointSource,
} from './checkpoint-source';
const request = '11111111-1111-4111-8111-111111111111';
const receipt = '22222222-2222-4222-8222-222222222222';
function capture(source = 'package piscine\r\n// مرحبا\n') {
  return captureCheckpointSource({
    cohort: 'cohort',
    node: 'checkpoint',
    attemptId: 'attempt',
    taskKey: 'question-one',
    source,
    rules: { required_files: ['answer.go'], max_size_kb: 256 },
  });
}
function intents() {
  return new SubmissionIntents(
    () => null,
    () => request,
  );
}
describe('Checkpoint editor uses existing official source contract', () => {
  it('freezes exact Unicode, BOM and line endings before asynchronous work', () => {
    const source = '\uFEFFpackage piscine\r\n// مرحبا\n';
    const snapshot = capture(source);
    expect(snapshot.source).toBe(source);
    expect(snapshot.byteLength).toBe(new TextEncoder().encode(source).length);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).not.toHaveProperty('definitionDigest');
  });
  it.each(['', '\ud800', 'x'.repeat(262145)])('rejects invalid or unbounded source', (source) =>
    expect(() => capture(source)).toThrow(),
  );
  it('requires one supported exact published filename and byte ceiling', () => {
    const base = capture();
    for (const rules of [
      { required_files: ['a.go', 'b.go'], max_size_kb: 1 },
      { required_files: ['../a.go'], max_size_kb: 1 },
      { required_files: [], max_size_kb: 1 },
      { required_files: ['a.go'], max_size_kb: NaN },
      { required_files: ['a.go'], max_size_kb: 1 },
    ])
      expect(() => captureCheckpointSource({ ...base, source: 'é'.repeat(600), rules })).toThrow();
  });
  it('retains the same request for uncertain identical source, separates tasks and ends confirmed intent', async () => {
    let count = 0;
    const ids = new SubmissionIntents(
      () => null,
      () => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`,
    );
    const first = await identifyCheckpointSource(capture(), ids);
    expect((await identifyCheckpointSource(capture(), ids)).requestId).toBe(first.requestId);
    expect(
      (await identifyCheckpointSource({ ...capture(), taskKey: 'question-two' }, ids)).requestId,
    ).not.toBe(first.requestId);
    ids.confirm(first.intent);
    expect((await identifyCheckpointSource(capture(), ids)).requestId).not.toBe(first.requestId);
  });
  it('sends the immutable original source on retry even after editing the selected question', async () => {
    const source = capture();
    const snapshot = await identifyCheckpointSource(source, intents());
    let drafts = editQuestion({}, 'question-one', source.source);
    drafts = editQuestion(drafts, 'question-one', 'later edit');
    drafts = editQuestion(drafts, 'question-two', 'different question');
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: receipt }, { status: 202 }));
    expect(await sendCheckpointSource(snapshot, send)).toEqual({ kind: 'accepted', id: receipt });
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe('/api/checkpoints/submissions');
    expect(init?.headers).toMatchObject({
      'x-task-key': 'question-one',
      'x-filename': 'answer.go',
      'idempotency-key': request,
    });
    expect(await (init?.body as Blob).text()).toBe(source.source.replace(/^\uFEFF/, ''));
    const acknowledged = acceptQuestion(drafts, snapshot);
    expect(questionDraft(acknowledged, 'question-one')).toEqual({
      source: 'later edit',
      acceptedSource: source.source,
    });
    expect(questionDraft(acknowledged, 'question-two').source).toBe('different question');
    expect(hasUnsubmittedDrafts(acknowledged)).toBe(true);
  });
  it('preserves exact UTF-8 BOM bytes in official transport', async () => {
    const source = capture('\uFEFFpackage piscine\r\n');
    const snapshot = await identifyCheckpointSource(source, intents());
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: receipt }, { status: 202 }));
    await sendCheckpointSource(snapshot, send);
    expect(new Uint8Array(await (send.mock.calls[0]![1]?.body as Blob).arrayBuffer())).toEqual(
      new TextEncoder().encode(source.source),
    );
  });
  it.each([400, 409, 413, 429, 500, 503])(
    'never presents HTTP %i as acceptance or a grade',
    async (status) => {
      const result = await sendCheckpointSource(
        await identifyCheckpointSource(capture(), intents()),
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
      );
      expect(result).toEqual({ kind: 'uncertain' });
    },
  );
  it.each([401, 403])('removes protected editor on HTTP %i', async (status) => {
    expect(
      await sendCheckpointSource(
        await identifyCheckpointSource(capture(), intents()),
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
      ),
    ).toEqual({ kind: 'access_removed' });
  });
  it('requires a valid accepted receipt, handles lost acknowledgement and malformed response', async () => {
    const snapshot = await identifyCheckpointSource(capture(), intents());
    for (const send of [
      vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ id: 'not-a-receipt' }, { status: 202 })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{', { status: 202 })),
    ])
      expect(await sendCheckpointSource(snapshot, send)).toEqual({ kind: 'uncertain' });
  });
  it('preserves per-question draft and accepted-source identity without assuming previous pass', () => {
    let d = editQuestion({}, 'third', 'three');
    d = editQuestion(d, 'first', 'one');
    expect(questionDraft(d, 'third').source).toBe('three');
    expect(questionDraft(d, 'second')).toEqual({ source: '', acceptedSource: null });
    expect(hasUnsubmittedDrafts(d)).toBe(true);
    d = acceptQuestion(d, { ...capture('one'), taskKey: 'first' });
    expect(questionDraft(d, 'first')).toEqual({ source: 'one', acceptedSource: 'one' });
    expect(hasUnsubmittedDrafts({ first: questionDraft(d, 'first') })).toBe(false);
  });
  it('warns when an accepted draft is subsequently cleared, but not for untouched empty buffers', () => {
    expect(hasUnsubmittedDrafts(editQuestion({}, 'first', ''))).toBe(false);
    const accepted = acceptQuestion(editQuestion({}, 'first', 'one'), {
      ...capture('one'),
      taskKey: 'first',
    });
    expect(hasUnsubmittedDrafts(editQuestion(accepted, 'first', ''))).toBe(true);
  });
  it('handles task keys that collide with Object prototype names as independent empty drafts', () => {
    expect(questionDraft({}, 'constructor')).toEqual({ source: '', acceptedSource: null });
    expect(questionDraft(editQuestion({}, 'constructor', 'draft'), 'constructor').source).toBe(
      'draft',
    );
  });
});
