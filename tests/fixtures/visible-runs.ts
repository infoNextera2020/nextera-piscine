/** Pure synthetic values only. No database connection, catalog publication or policy default. */
import { createHash } from 'node:crypto';
import {
  runIntentDigest,
  runSourceDigest,
  serializeVisibleExampleManifest,
  serializeVisibleRunPolicy,
  visibleManifestDigest,
  visiblePolicyDigest,
  type VisibleRunIntent,
} from '../../apps/web/lib/checkpoints/visible-run-spec';
export function visibleRunStorageFixture() {
  const id = '10000000-0000-4000-8000-000000000001',
    request = '20000000-0000-4000-8000-000000000002',
    run = '30000000-0000-4000-8000-000000000003',
    lease = '40000000-0000-4000-8000-000000000004';
  const definition = 'a'.repeat(64),
    scope = {
      learnerId: id,
      cohortId: id,
      attemptId: id,
      taskKey: 'question-a',
      definitionDigest: definition,
    };
  const manifest = {
    version: 1,
    visibility: 'visible_examples',
    language: 'go',
    taskKey: scope.taskKey,
    definitionDigest: definition,
    filename: 'answer.go',
    harness: {
      kind: 'go_function_v1',
      packageName: 'piscine',
      functionName: 'Answer',
      argument: 'string',
      returns: 'string',
    },
    examples: [{ key: 'one', input: 'a', expectedOutput: 'a' }],
  };
  const policy = {
    version: 1,
    key: 'synthetic-only',
    enabled: true,
    visibility: 'visible_examples',
    graded: false,
    consumesGradedAttempts: false,
    limits: {
      timeoutMs: 1000,
      memoryMb: 64,
      outputBytes: 64,
      sourceBytes: 128,
      requestsPerWindow: 2,
      windowMs: 10000,
      concurrency: 1,
    },
    maxExamples: 1,
    budgets: { compilationMs: 3000, startupMs: 1000, leaseMs: 5000 },
    storage: {
      maxRunsPerAttempt: 10,
      maxSourceBytesPerAttempt: 1024,
      readAfterDeadlineSeconds: 60,
    },
    isolation: {
      imageDigest: 'sha256:' + 'b'.repeat(64),
      network: 'none',
      hostAccess: 'none',
      filesystem: 'disposable',
      processUser: 'unprivileged',
      resourceEnforcement: 'external',
    },
  };
  const editor = {
    scope,
    readAllowed: true,
    status: 'active' as const,
    serverNow: '2026-10-27T10:00:00.000000Z',
    deadline: '2026-10-27T11:00:00.000000Z',
    sourceBytes: 128,
    filename: 'answer.go',
  };
  const source = '\uFEFFpackage piscine\r\n// caf\u00e9\u0000';
  const intent: VisibleRunIntent = {
    scope,
    requestId: request,
    filename: 'answer.go',
    source,
    sourceDigest: runSourceDigest(source),
    byteLength: Buffer.byteLength(source),
    manifestDigest: visibleManifestDigest(manifest),
    policyDigest: visiblePolicyDigest(policy),
    deadline: editor.deadline,
  };
  const authority = {
    editor,
    manifestBase64: Buffer.from(serializeVisibleExampleManifest(manifest)).toString('base64'),
    manifestDigest: intent.manifestDigest,
    policyBase64: Buffer.from(serializeVisibleRunPolicy(policy)).toString('base64'),
    policyDigest: intent.policyDigest,
  };
  const wire = (state = 'queued', output: string | null = null) => ({
    intent: { ...intent, source: undefined, sourceBase64: Buffer.from(source).toString('base64') },
    intentDigest: runIntentDigest(intent),
    record: {
      id: run,
      requestId: request,
      sourceDigest: intent.sourceDigest,
      state,
      outputBase64: output === null ? null : Buffer.from(output).toString('base64'),
    },
  });
  const rawBlobHash = (domain: string, text: string) =>
    createHash('sha256')
      .update(domain + '\0v1\0')
      .update(text)
      .digest('hex');
  return {
    id,
    request,
    run,
    lease,
    scope,
    manifest,
    policy,
    editor,
    source,
    intent,
    authority,
    wire,
    rawBlobHash,
  };
}
