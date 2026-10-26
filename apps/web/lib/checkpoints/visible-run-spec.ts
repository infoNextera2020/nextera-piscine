import { createHash } from 'node:crypto';
import { isRequestId } from '@nextera/domain';
import { validVisibleRunLimits, type EditorScope, type VisibleRunLimits } from './editor-contract';

// Parser/transport ceilings, not enabled production Run allowances.
const ceiling = 262144;
const hashPattern = /^[0-9a-f]{64}$/;
const keyPattern = /^[a-z0-9-]{1,100}$/;
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const keywords = new Set(
  'break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var _'.split(
    ' ',
  ),
);
export class VisibleRunSpecError extends Error {
  constructor() {
    super('VISIBLE_RUN_SPEC_UNAVAILABLE');
  }
}
function invalid(): never {
  throw new VisibleRunSpecError();
}
function object(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    invalid();
  return record;
}
export function exactRunBytes(source: unknown, maxBytes: number, empty = false) {
  if (
    typeof source !== 'string' ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > ceiling ||
    source.length > ceiling
  )
    invalid();
  const bytes = Buffer.from(source, 'utf8');
  if (
    (!empty && bytes.length === 0) ||
    bytes.length > maxBytes ||
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== source
  )
    invalid();
  return bytes;
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function symbol(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 100 ||
    !identifier.test(value) ||
    keywords.has(value)
  )
    invalid();
  return value;
}
export type VisibleExampleManifest = Readonly<{
  version: 1;
  visibility: 'visible_examples';
  language: 'go';
  taskKey: string;
  definitionDigest: string;
  filename: string;
  harness: Readonly<{
    kind: 'go_function_v1';
    packageName: string;
    functionName: string;
    argument: 'string' | 'int64';
    returns: 'string';
  }>;
  examples: readonly Readonly<{ key: string; input: string; expectedOutput: string }>[];
}>;
/** Data-only public ABI. No commands, arbitrary harness code, URLs or private pack references. */
export function parseVisibleExampleManifest(value: unknown): VisibleExampleManifest {
  const m = object(value, [
    'version',
    'visibility',
    'language',
    'taskKey',
    'definitionDigest',
    'filename',
    'harness',
    'examples',
  ]);
  if (
    m.version !== 1 ||
    m.visibility !== 'visible_examples' ||
    m.language !== 'go' ||
    typeof m.taskKey !== 'string' ||
    !keyPattern.test(m.taskKey) ||
    typeof m.definitionDigest !== 'string' ||
    !hashPattern.test(m.definitionDigest) ||
    typeof m.filename !== 'string' ||
    m.filename.length > 100 ||
    !/^[A-Za-z0-9_]+\.go$/.test(m.filename)
  )
    invalid();
  const h = object(m.harness, ['kind', 'packageName', 'functionName', 'argument', 'returns']);
  if (
    h.kind !== 'go_function_v1' ||
    !['string', 'int64'].includes(String(h.argument)) ||
    h.returns !== 'string'
  )
    invalid();
  const harness = Object.freeze({
    kind: 'go_function_v1' as const,
    packageName: symbol(h.packageName),
    functionName: symbol(h.functionName),
    argument: h.argument as 'string' | 'int64',
    returns: 'string' as const,
  });
  if (!Array.isArray(m.examples) || m.examples.length === 0 || m.examples.length > ceiling)
    invalid();
  const seen = new Set<string>();
  let budget = 0;
  const examples = m.examples.map((value) => {
    const e = object(value, ['key', 'input', 'expectedOutput']);
    if (typeof e.key !== 'string' || !keyPattern.test(e.key) || seen.has(e.key)) invalid();
    seen.add(e.key);
    exactRunBytes(e.input, ceiling, true);
    exactRunBytes(e.expectedOutput, ceiling, true);
    if (harness.argument === 'int64') {
      if (
        typeof e.input !== 'string' ||
        !/^(0|-?[1-9][0-9]*)$/.test(e.input) ||
        e.input.length > 20
      )
        invalid();
      const integer = BigInt(e.input);
      if (integer < -9223372036854775808n || integer > 9223372036854775807n) invalid();
    }
    const example = Object.freeze({
      key: e.key,
      input: e.input as string,
      expectedOutput: e.expectedOutput as string,
    });
    budget += Buffer.byteLength(JSON.stringify(example));
    if (budget > ceiling) invalid();
    return example;
  });
  const result = Object.freeze({
    version: 1 as const,
    visibility: 'visible_examples' as const,
    language: 'go' as const,
    taskKey: m.taskKey,
    definitionDigest: m.definitionDigest,
    filename: m.filename,
    harness,
    examples: Object.freeze(examples),
  });
  exactRunBytes(JSON.stringify(result), ceiling);
  return result;
}
export function visibleManifestDigest(manifest: unknown) {
  return hash(
    'nextera-visible-examples\0v1\0' + JSON.stringify(parseVisibleExampleManifest(manifest)),
  );
}
export type VisibleRunPolicy = Readonly<{
  version: 1;
  key: string;
  enabled: true;
  visibility: 'visible_examples';
  graded: false;
  consumesGradedAttempts: false;
  limits: VisibleRunLimits;
  maxExamples: number;
  isolation: Readonly<{
    imageDigest: string;
    network: 'none';
    hostAccess: 'none';
    filesystem: 'disposable';
    processUser: 'unprivileged';
    resourceEnforcement: 'external';
  }>;
}>;
/** No fallback defaults. An explicitly reviewed server policy is required before enqueueing. */
export function parseVisibleRunPolicy(value: unknown): VisibleRunPolicy {
  const p = object(value, [
    'version',
    'key',
    'enabled',
    'visibility',
    'graded',
    'consumesGradedAttempts',
    'limits',
    'maxExamples',
    'isolation',
  ]);
  if (
    p.version !== 1 ||
    typeof p.key !== 'string' ||
    !keyPattern.test(p.key) ||
    p.enabled !== true ||
    p.visibility !== 'visible_examples' ||
    p.graded !== false ||
    p.consumesGradedAttempts !== false ||
    !Number.isSafeInteger(p.maxExamples) ||
    Number(p.maxExamples) < 1 ||
    Number(p.maxExamples) > ceiling
  )
    invalid();
  const l = object(p.limits, [
    'timeoutMs',
    'memoryMb',
    'outputBytes',
    'sourceBytes',
    'requestsPerWindow',
    'windowMs',
    'concurrency',
  ]);
  if (
    !validVisibleRunLimits(l as VisibleRunLimits) ||
    Number(l.sourceBytes) > ceiling ||
    Number(l.outputBytes) > ceiling
  )
    invalid();
  const i = object(p.isolation, [
    'imageDigest',
    'network',
    'hostAccess',
    'filesystem',
    'processUser',
    'resourceEnforcement',
  ]);
  if (
    typeof i.imageDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(i.imageDigest) ||
    i.network !== 'none' ||
    i.hostAccess !== 'none' ||
    i.filesystem !== 'disposable' ||
    i.processUser !== 'unprivileged' ||
    i.resourceEnforcement !== 'external'
  )
    invalid();
  return Object.freeze({
    version: 1,
    key: p.key,
    enabled: true,
    visibility: 'visible_examples',
    graded: false,
    consumesGradedAttempts: false,
    limits: Object.freeze({ ...l }) as VisibleRunLimits,
    maxExamples: Number(p.maxExamples),
    isolation: Object.freeze({ ...i }) as VisibleRunPolicy['isolation'],
  });
}
export function visiblePolicyDigest(policy: unknown) {
  const p = parseVisibleRunPolicy(policy);
  // Canonical key order even when the supplied configuration object's order differs.
  const {
    timeoutMs,
    memoryMb,
    outputBytes,
    sourceBytes,
    requestsPerWindow,
    windowMs,
    concurrency,
  } = p.limits;
  const { imageDigest, network, hostAccess, filesystem, processUser, resourceEnforcement } =
    p.isolation;
  return hash(
    'nextera-visible-run-policy\0v1\0' +
      JSON.stringify({
        ...p,
        limits: {
          timeoutMs,
          memoryMb,
          outputBytes,
          sourceBytes,
          requestsPerWindow,
          windowMs,
          concurrency,
        },
        isolation: {
          imageDigest,
          network,
          hostAccess,
          filesystem,
          processUser,
          resourceEnforcement,
        },
      }),
  );
}
export type VisibleRunIntent = Readonly<{
  scope: EditorScope;
  requestId: string;
  filename: string;
  source: string;
  sourceDigest: string;
  byteLength: number;
  manifestDigest: string;
  policyDigest: string;
  deadline: string;
}>;
export function runIntentDigest(intent: VisibleRunIntent) {
  const s = intent.scope;
  return hash(
    'nextera-visible-run-intent\0v1\0' +
      JSON.stringify([
        s.learnerId,
        s.cohortId,
        s.attemptId,
        s.taskKey,
        s.definitionDigest,
        intent.requestId,
        intent.filename,
        intent.sourceDigest,
        intent.byteLength,
        intent.manifestDigest,
        intent.policyDigest,
        intent.deadline,
      ]),
  );
}
export function runSourceDigest(source: string) {
  return hash(exactRunBytes(source, ceiling));
}

export type VisibleRunWork = Readonly<{
  runId: string;
  intent: VisibleRunIntent;
  manifest: VisibleExampleManifest;
  policy: VisibleRunPolicy;
}>;
export function prepareVisibleRunWork(
  runId: string,
  intent: VisibleRunIntent,
  manifest: unknown,
  policy: unknown,
): VisibleRunWork {
  const m = parseVisibleExampleManifest(manifest),
    p = parseVisibleRunPolicy(policy),
    s = intent.scope;
  if (
    !isRequestId(runId) ||
    !isRequestId(intent.requestId) ||
    !isRequestId(s.learnerId) ||
    !isRequestId(s.cohortId) ||
    !isRequestId(s.attemptId) ||
    !keyPattern.test(s.taskKey) ||
    !hashPattern.test(s.definitionDigest) ||
    s.taskKey !== m.taskKey ||
    s.definitionDigest !== m.definitionDigest ||
    intent.filename !== m.filename ||
    intent.manifestDigest !== visibleManifestDigest(m) ||
    intent.policyDigest !== visiblePolicyDigest(p) ||
    !Number.isFinite(Date.parse(intent.deadline)) ||
    m.examples.length > p.maxExamples
  )
    invalid();
  const bytes = exactRunBytes(intent.source, p.limits.sourceBytes);
  if (intent.byteLength !== bytes.length || intent.sourceDigest !== runSourceDigest(intent.source))
    invalid();
  return Object.freeze({
    runId,
    intent: Object.freeze({
      scope: Object.freeze({
        learnerId: s.learnerId,
        cohortId: s.cohortId,
        attemptId: s.attemptId,
        taskKey: s.taskKey,
        definitionDigest: s.definitionDigest,
      }),
      requestId: intent.requestId,
      filename: intent.filename,
      source: intent.source,
      sourceDigest: intent.sourceDigest,
      byteLength: intent.byteLength,
      manifestDigest: intent.manifestDigest,
      policyDigest: intent.policyDigest,
      deadline: intent.deadline,
    }),
    manifest: m,
    policy: p,
  });
}
export type VisibleRunOutcome = Readonly<{
  runId: string;
  intentDigest: string;
  state:
    'completed' | 'compile_error' | 'runtime_error' | 'timeout' | 'output_limit' | 'system_error';
  output: string;
}>;
/** Interface only: a future worker must verify its actual sandbox, leases and trusted deadline.
 * No shell/command/private-pack field, ambient credential, arbitrary environment or mount is accepted.
 * Isolation declarations are requirements, not evidence that a sandbox exists. */
export interface IsolatedVisibleRunExecutor {
  execute(work: VisibleRunWork, signal: AbortSignal): Promise<unknown>;
}
export function projectVisibleRunOutcome(work: VisibleRunWork, value: unknown): VisibleRunOutcome {
  work = prepareVisibleRunWork(work.runId, work.intent, work.manifest, work.policy);
  if (!value || typeof value !== 'object') invalid();
  const r = value as Record<string, unknown>;
  if (
    r.runId !== work.runId ||
    r.intentDigest !== runIntentDigest(work.intent) ||
    ![
      'completed',
      'compile_error',
      'runtime_error',
      'timeout',
      'output_limit',
      'system_error',
    ].includes(String(r.state))
  )
    invalid();
  // Operational diagnostics are never exposed as learner output.
  const output = r.state === 'system_error' ? '' : r.output;
  exactRunBytes(output, work.policy.limits.outputBytes, true);
  return Object.freeze({
    runId: work.runId,
    intentDigest: runIntentDigest(work.intent),
    state: r.state as VisibleRunOutcome['state'],
    output: output as string,
  });
}
