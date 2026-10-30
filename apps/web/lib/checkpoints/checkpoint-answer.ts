import { checkpointAnswerFormat, type CheckpointAnswerFormat } from '@nextera/domain';
import type { EditorScope } from './editor-contract';

export type MixedCheckpointAnswer =
  | Readonly<{ version: 1; kind: 'trace_with_reason'; output: string; reason: string }>
  | Readonly<{
      version: 1;
      kind: 'debug_with_reason';
      source: string;
      explanation: string;
      counterexample: string;
    }>;
export type MixedAnswerDrafts = Readonly<Record<string, MixedCheckpointAnswer>>;
const fields = {
  trace_with_reason: ['output', 'reason'],
  debug_with_reason: ['source', 'explanation', 'counterexample'],
} as const;

function answerKey(taskKey: string, kind: MixedCheckpointAnswer['kind']) {
  if (!taskKey) throw new Error('CHECKPOINT_ANSWER_SCOPE');
  return JSON.stringify([taskKey, 1, kind]);
}
export function emptyMixedAnswer(kind: MixedCheckpointAnswer['kind']): MixedCheckpointAnswer {
  return kind === 'trace_with_reason'
    ? { version: 1, kind, output: '', reason: '' }
    : { version: 1, kind, source: '', explanation: '', counterexample: '' };
}
/** Kind changes cannot reinterpret or discard the previous response. The attempt owns this map. */
export function mixedAnswerDraft(
  drafts: MixedAnswerDrafts,
  taskKey: string,
  kind: MixedCheckpointAnswer['kind'],
): MixedCheckpointAnswer {
  const key = answerKey(taskKey, kind);
  return Object.hasOwn(drafts, key) ? drafts[key]! : emptyMixedAnswer(kind);
}
function validatedAnswer(value: unknown, requireUtf8 = true): MixedCheckpointAnswer {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('CHECKPOINT_ANSWER_INVALID');
  const answer = value as Record<string, unknown>;
  if (!Object.hasOwn(answer, 'version') || !Object.hasOwn(answer, 'kind'))
    throw new Error('CHECKPOINT_ANSWER_INVALID');
  const format = checkpointAnswerFormat({ version: answer.version, kind: answer.kind });
  if (format.kind === 'coding') throw new Error('CHECKPOINT_ANSWER_INVALID');
  const names = fields[format.kind];
  if (
    Reflect.ownKeys(answer).length !== names.length + 2 ||
    !names.every((key) => Object.hasOwn(answer, key) && typeof answer[key] === 'string') ||
    (requireUtf8 &&
      !names.every((key) => {
        const text = answer[key] as string;
        return (
          new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(text)) ===
          text
        );
      }))
  )
    throw new Error('CHECKPOINT_ANSWER_INVALID');
  return format.kind === 'trace_with_reason'
    ? Object.freeze({
        version: 1,
        kind: format.kind,
        output: answer.output as string,
        reason: answer.reason as string,
      })
    : Object.freeze({
        version: 1,
        kind: format.kind,
        source: answer.source as string,
        explanation: answer.explanation as string,
        counterexample: answer.counterexample as string,
      });
}
export function editMixedAnswer(
  drafts: MixedAnswerDrafts,
  taskKey: string,
  answer: MixedCheckpointAnswer,
): MixedAnswerDrafts {
  const validated = validatedAnswer(answer, false);
  return { ...drafts, [answerKey(taskKey, answer.kind)]: validated };
}
export function hasMixedAnswerDrafts(drafts: MixedAnswerDrafts) {
  return Object.values(drafts).some((answer) =>
    fields[answer.kind].some((key) => (answer as unknown as Record<string, string>)[key] !== ''),
  );
}
/** Exact text, fixed property order, and a shared UTF-8 byte ceiling; no trim or newline rewrite. */
export function serializeMixedAnswer(answer: unknown, maxBytes: number) {
  const valid = validatedAnswer(answer);
  const payload = JSON.stringify(valid);
  const byteLength = new TextEncoder().encode(payload).byteLength;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > 262144 ||
    byteLength > maxBytes
  )
    throw new Error('CHECKPOINT_ANSWER_SIZE');
  return Object.freeze({ answer: valid, payload, byteLength });
}
export function captureMixedAnswer(scope: EditorScope, answer: unknown, maxBytes: number) {
  if (
    !scope ||
    !['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest'].every(
      (key) =>
        typeof scope[key as keyof EditorScope] === 'string' && scope[key as keyof EditorScope],
    ) ||
    !/^[0-9a-f]{64}$/.test(scope.definitionDigest)
  )
    throw new Error('CHECKPOINT_ANSWER_SCOPE');
  const snapshot = serializeMixedAnswer(answer, maxBytes);
  const content = snapshot.answer;
  const required =
    content.kind === 'trace_with_reason'
      ? [content.reason]
      : [content.source, content.explanation, content.counterexample];
  if (required.some((text) => !text.trim())) throw new Error('CHECKPOINT_ANSWER_INCOMPLETE');
  return Object.freeze({ ...snapshot, scope: Object.freeze({ ...scope }) });
}
/** The installed draft/Submit transports accept source only. No capability is inferred from UI. */
export function checkpointAnswerActionBlock(
  format: CheckpointAnswerFormat,
  action: 'save' | 'submit' | 'run',
) {
  const parsed = checkpointAnswerFormat(format);
  if (parsed.kind === 'coding') return null;
  return action === 'run' && parsed.kind === 'trace_with_reason'
    ? 'trace_run_not_applicable'
    : 'answer_transport_unavailable';
}

/** Never bootstrap a mixed response through the legacy source autosave endpoint. */
export function checkpointSourceTaskKey(
  task:
    | {
        key: string;
        answer_format?: CheckpointAnswerFormat | undefined;
      }
    | undefined,
) {
  return task && checkpointAnswerFormat(task.answer_format).kind === 'coding' ? task.key : '';
}
