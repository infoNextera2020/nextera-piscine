import 'server-only';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { posix } from 'node:path';
import { prepareVisibleRunWork, projectVisibleRunOutcome } from './visible-run-spec';
import {
  publicExecutionBinding,
  visibleRunExecutionId,
  type FencedPublicExecutor,
  type PublicExecutionRequest,
} from './visible-run-worker';

const unavailable = () => new Error('PUBLIC_EXECUTION_UNAVAILABLE');
const digest = /^[0-9a-f]{64}$/;
// Transport ceilings, not enabled Run policy or learner allowances.
const requestCeiling = 1 << 20;
const binaryCeiling = 64 << 20;
const cleanupBudget = 15000; // Existing Go supervisor's independent cleanup budget.
export type PublicRunProcessConfiguration = Readonly<{
  executable: string;
  executableSha256: string;
  runnerImage: string;
  dockerSocket: string;
  cleanupGraceMs: number;
  exitGraceMs: number;
}>;
export type VerifiedPublicRunBinary = Readonly<{ fd: number; close(): Promise<void> }>;
export type PublicRunProcessTransport = Readonly<{
  platform: string;
  now(): number;
  openBinary(path: string, sha256: string): Promise<VerifiedPublicRunBinary>;
  launch(
    executable: string,
    args: readonly string[],
    options: Readonly<{
      cwd: string;
      env: Readonly<Record<string, string>>;
      shell: false;
      windowsHide: true;
      stdio: readonly ['pipe', 'pipe', 'pipe', number];
    }>,
  ): ChildProcessWithoutNullStreams;
}>;
function absolute(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 1 &&
    path.length <= 4096 &&
    posix.isAbsolute(path) &&
    posix.normalize(path) === path &&
    !/[\0\r\n]/.test(path)
  );
}
async function openBinary(path: string, sha256: string): Promise<VerifiedPublicRunBinary> {
  if (process.platform !== 'linux' || (await realpath(path)) !== path) throw unavailable();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > binaryCeiling ||
      (stat.mode & 0o022) !== 0 ||
      (stat.mode & 0o111) === 0 ||
      (stat.uid !== 0 && stat.uid !== process.geteuid?.())
    )
      throw unavailable();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      bytes.length !== stat.size ||
      stat.size !== after.size ||
      stat.mtimeMs !== after.mtimeMs ||
      createHash('sha256').update(bytes).digest('hex') !== sha256
    )
      throw unavailable();
    // Inherit this exact open inode as fd3, rather than reopening a replaceable pathname.
    return { fd: handle.fd, close: () => handle.close() };
  } catch {
    await handle.close();
    throw unavailable();
  }
}
const localTransport: PublicRunProcessTransport = {
  platform: process.platform,
  now: Date.now,
  openBinary,
  launch(executable, args, options) {
    // Node supports an empty environment; Next's ambient ProcessEnv type requires NODE_ENV.
    // Keep this explicit cast rather than inheriting environment credentials to satisfy that type.
    return spawn(executable, [...args], {
      ...options,
      env: { ...options.env } as NodeJS.ProcessEnv,
      stdio: [...options.stdio],
    }) as ChildProcessWithoutNullStreams;
  },
};

/** A flat typed receipt only: reject duplicate keys, nested data, trailing JSON and unknown fields. */
function receipt(text: string): Record<string, unknown> {
  let at = 0;
  const skip = () => {
    while (at < text.length && /[\x20\t\r\n]/.test(text[at]!)) at++;
  };
  // JSON.parse below also rejects unescaped control characters in a string token.
  const token = /"(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|null|(?:0|[1-9][0-9]*)/y;
  const read = (): unknown => {
    skip();
    token.lastIndex = at;
    const match = token.exec(text);
    if (!match) throw unavailable();
    at = token.lastIndex;
    return JSON.parse(match[0]);
  };
  const fields: [string, unknown][] = [],
    seen = new Set<string>();
  skip();
  if (text[at++] !== '{') throw unavailable();
  skip();
  while (text[at] !== '}') {
    const key = read();
    if (typeof key !== 'string' || seen.has(key)) throw unavailable();
    seen.add(key);
    skip();
    if (text[at++] !== ':') throw unavailable();
    fields.push([key, read()]);
    skip();
    if (text[at] === '}') break;
    if (text[at++] !== ',') throw unavailable();
    skip();
    if (text[at] === '}') throw unavailable();
  }
  at++;
  skip();
  const keys = [
    'runId',
    'intentDigest',
    'generation',
    'executionId',
    'state',
    'output',
    'stoppedProof',
  ];
  if (at !== text.length || fields.length !== keys.length || keys.some((k) => !seen.has(k)))
    throw unavailable();
  return Object.fromEntries(fields);
}

/** Explicit preparation only. No environment lookup, process, socket, timer or connection on construction. */
export function createPublicRunProcessExecutor(
  config: PublicRunProcessConfiguration,
  transport: PublicRunProcessTransport = localTransport,
): FencedPublicExecutor {
  if (
    transport.platform !== 'linux' ||
    !absolute(config.executable) ||
    !absolute(config.dockerSocket) ||
    !digest.test(config.executableSha256) ||
    !/^sha256:[0-9a-f]{64}$/.test(config.runnerImage) ||
    !Number.isSafeInteger(config.cleanupGraceMs) ||
    config.cleanupGraceMs < cleanupBudget + 1000 ||
    config.cleanupGraceMs > 60000 ||
    !Number.isSafeInteger(config.exitGraceMs) ||
    config.exitGraceMs < 100 ||
    config.exitGraceMs > 5000
  )
    throw unavailable();
  // Copy trusted operator configuration so later caller mutation cannot change execution.
  const settings = Object.freeze({ ...config });
  return {
    async execute(value: PublicExecutionRequest, signal: AbortSignal): Promise<unknown> {
      let binary: VerifiedPublicRunBinary | undefined;
      try {
        if (signal.aborted) throw unavailable();
        const work = prepareVisibleRunWork(
          value.work.runId,
          value.work.intent,
          value.work.manifest,
          value.work.policy,
        );
        if (
          value.version !== 1 ||
          !Number.isSafeInteger(value.generation) ||
          value.generation < 1 ||
          value.executionId !== visibleRunExecutionId(work.runId, value.generation) ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
            work.intent.deadline,
          ) ||
          work.policy.isolation.imageDigest !== settings.runnerImage ||
          work.manifest.harness.packageName !== 'main' ||
          work.policy.limits.timeoutMs !== 2000 ||
          work.policy.limits.memoryMb !== 64 ||
          work.policy.limits.outputBytes !== 65536 ||
          work.policy.budgets.compilationMs !== 20000 ||
          work.policy.budgets.startupMs + work.policy.budgets.compilationMs >= 45000
        )
          throw unavailable();
        const request = Object.freeze({
          version: 1 as const,
          generation: value.generation,
          executionId: value.executionId,
          work,
        });
        const body = Buffer.from(JSON.stringify(request));
        if (body.length > requestCeiling) throw unavailable();
        const executionBudget =
          work.policy.budgets.startupMs +
          work.policy.budgets.compilationMs +
          work.policy.limits.timeoutMs;
        const remaining = Date.parse(work.intent.deadline) - transport.now();
        if (remaining <= 0 || !Number.isFinite(remaining)) throw unavailable();
        binary = await transport.openBinary(settings.executable, settings.executableSha256);
        if (signal.aborted || Date.parse(work.intent.deadline) <= transport.now())
          throw unavailable();
        const opened = binary;
        return await new Promise<unknown>((resolve, reject) => {
          let child: ChildProcessWithoutNullStreams | undefined;
          let settled = false,
            stopping = false,
            forced = false,
            bad = false;
          const chunks: Buffer[] = [];
          let count = 0;
          // Go JSON escaping may expand a valid decoded output up to sixfold.
          const outputCeiling = work.policy.limits.outputBytes * 6 + 4096;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let stopTimer: ReturnType<typeof setTimeout> | undefined;
          let killTimer: ReturnType<typeof setTimeout> | undefined;
          const finish = (result?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearTimeout(stopTimer);
            clearTimeout(killTimer);
            signal.removeEventListener('abort', stop);
            if (result === undefined) reject(unavailable());
            else resolve(result);
          };
          const stop = () => {
            if (settled || stopping) return;
            stopping = true;
            try {
              child?.kill('SIGTERM');
            } catch {
              /* Absence of a close receipt remains uncertain. */
            }
            if (settled) return;
            stopTimer = setTimeout(() => {
              forced = true;
              try {
                child?.kill('SIGKILL');
              } catch {
                /* Never infer container cleanup. */
              }
              if (settled) return;
              killTimer = setTimeout(() => finish(), settings.exitGraceMs);
            }, settings.cleanupGraceMs);
          };
          try {
            child = transport.launch(
              '/proc/self/fd/3',
              [
                'public-run-stdio',
                '--runner-image',
                settings.runnerImage,
                '--docker-socket',
                settings.dockerSocket,
              ],
              {
                cwd: posix.dirname(settings.executable),
                env: {},
                shell: false,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe', opened.fd],
              },
            );
            child.on('error', () => {
              bad = true;
              if (child?.pid) stop();
              else finish();
            });
            child.stdout.on('data', (chunk: Buffer) => {
              if (settled || bad) return;
              const bytes = Buffer.from(chunk);
              count += bytes.length;
              if (count > outputCeiling) {
                bad = true;
                stop();
                return;
              }
              chunks.push(bytes);
            });
            child.stdout.on('error', () => {
              bad = true;
              stop();
            });
            child.stderr.on('error', () => {
              bad = true;
              stop();
            });
            child.stderr.on('data', () => {
              bad = true;
              stop();
            });
            child.stdin.on('error', () => {
              bad = true;
              stop();
            });
            child.once('close', (code, exitSignal) => {
              if (settled) return;
              try {
                if (bad || forced || code !== 0 || exitSignal !== null) throw unavailable();
                const raw = Buffer.concat(chunks);
                const result = receipt(
                  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw),
                );
                const binding = publicExecutionBinding(request);
                if (
                  Object.entries(binding).some(([key, v]) => result[key] !== v) ||
                  (result.stoppedProof !== null &&
                    (typeof result.stoppedProof !== 'string' || !digest.test(result.stoppedProof)))
                )
                  throw unavailable();
                const projected = projectVisibleRunOutcome(work, result);
                finish(
                  Object.freeze({
                    ...projected,
                    generation: request.generation,
                    executionId: request.executionId,
                    stoppedProof: result.stoppedProof,
                  }),
                );
              } catch {
                finish();
              }
            });
            signal.addEventListener('abort', stop, { once: true });
            timer = setTimeout(
              stop,
              Math.max(
                1,
                Math.min(executionBudget, Date.parse(work.intent.deadline) - transport.now()),
              ),
            );
            if (signal.aborted) stop();
            // Exactly one bounded envelope followed by EOF; never put source/lease credentials in argv.
            child.stdin.end(body);
          } catch {
            bad = true;
            if (child) stop();
            else finish();
          }
        });
      } catch {
        throw unavailable();
      } finally {
        await binary?.close().catch(() => {});
      }
    },
  };
}
