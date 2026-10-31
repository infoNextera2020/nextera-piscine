/** Inert source module. No browser, provider, file or handoff access on import. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';

export const WEB_ORIGIN = 'http://127.0.0.1:3151';
export const AUTH_ORIGIN = 'http://127.0.0.1:56531';
export const CORE_URL =
  'file://wsl.localhost/Ubuntu/home/anas/nextera-piscine/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs';
export const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const CORE_TREE_SHA256 = '0c7d8cae7c6fce1d651f80b117825b4cc32627847252e2fa962e9cdc071366e6';
const EMAIL = 'week1-b-20261030-invitation1@example.invalid';
const NAME = 'Week 1 Synthetic Learner B';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ACK_KEYS = [
  'version',
  'scopeSha256',
  'sourceLockSha256',
  'nonce',
  'issueRequestId',
  'origin',
  'cohortId',
  'email',
  'displayName',
  'expiresAt',
  'tokenSha256',
  'issuedAt',
];
const HANDOFF_KEYS = [...ACK_KEYS, 'url', 'password'];
const fail = () => {
  throw new Error('AUTH_BROWSER_INPUT_INVALID');
};
const exact = (value, keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    fail();
};
const positive = (value) => Number.isSafeInteger(value) && value > 0;

/** Accept the broker's one compact JSON line. Duplicate keys/extra frames fail. */
function parseCompactFrame(bytes, maximumBytes) {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 65536 ||
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > maximumBytes
  )
    fail();
  try {
    const text = new TextDecoder('utf8', { fatal: true }).decode(bytes);
    if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) fail();
    const raw = text.slice(0, -1);
    const value = JSON.parse(raw);
    if (JSON.stringify(value) !== raw) fail();
    return value;
  } catch {
    return fail();
  }
}

export function parsePrivateHandoffFrame(bytes, maximumBytes) {
  const value = parseCompactFrame(bytes, maximumBytes);
  exact(value, HANDOFF_KEYS);
  return value;
}

export function parsePrivateRegistrationFrame(bytes, maximumBytes) {
  const value = parseCompactFrame(bytes, maximumBytes);
  exact(value, [
    'handoff',
    'expectedScope',
    'awaitingStartedAt',
    'cleanupAt',
    'deadline',
    'coreUrl',
    'coreTreeSha256',
    'executablePath',
    'profileDir',
  ]);
  exact(value.handoff, HANDOFF_KEYS);
  exact(value.expectedScope, ACK_KEYS);
  return value;
}

/** Caller must close stdin after its single frame, after the separate GO gate. */
async function readPrivateFrame(stream, maximumBytes, parse) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 65536) fail();
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += Buffer.byteLength(chunk);
      if (size > maximumBytes) fail();
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    try {
      return parse(buffer, maximumBytes);
    } finally {
      buffer.fill(0);
    }
  } catch {
    return fail();
  } finally {
    for (const bytes of chunks) bytes.fill(0);
  }
}

export const readPrivateHandoff = (stream, maximumBytes) =>
  readPrivateFrame(stream, maximumBytes, parsePrivateHandoffFrame);
export const readPrivateRegistrationInput = (stream, maximumBytes) =>
  readPrivateFrame(stream, maximumBytes, parsePrivateRegistrationFrame);

/** expectedScope is the independently read, persisted acknowledgement, no secrets. */
export function validateRegistrationInput(input, now) {
  try {
    const {
      handoff: h,
      expectedScope: ack,
      awaitingStartedAt,
      cleanupAt,
      deadline,
      coreUrl,
      coreTreeSha256,
      executablePath,
      profileDir,
    } = input;
    exact(h, HANDOFF_KEYS);
    exact(ack, ACK_KEYS);
    if (
      ACK_KEYS.some((key) => h[key] !== ack[key]) ||
      h.version !== 1 ||
      ![h.scopeSha256, h.sourceLockSha256, h.tokenSha256].every(
        (v) => typeof v === 'string' && HASH.test(v),
      ) ||
      ![h.nonce, h.issueRequestId, h.cohortId].every(
        (v) => typeof v === 'string' && UUID.test(v),
      ) ||
      h.nonce === h.issueRequestId ||
      h.origin !== WEB_ORIGIN ||
      h.email !== EMAIL ||
      h.displayName !== NAME ||
      ![h.issuedAt, h.expiresAt, awaitingStartedAt, cleanupAt, deadline, now].every(positive) ||
      awaitingStartedAt > h.issuedAt ||
      h.issuedAt > now ||
      now >= h.expiresAt ||
      now >= deadline ||
      deadline !== Math.min(awaitingStartedAt + 150000, cleanupAt, h.expiresAt) ||
      typeof h.password !== 'string' ||
      !/^[a-f0-9]{48}$/.test(h.password) ||
      coreUrl !== CORE_URL ||
      coreTreeSha256 !== CORE_TREE_SHA256 ||
      executablePath !== CHROME_PATH ||
      typeof profileDir !== 'string' ||
      !/^[A-Za-z]:\\/.test(profileDir) ||
      profileDir.includes('/') ||
      [...profileDir].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      /["<>|?*]/.test(profileDir) ||
      profileDir.slice(2).includes(':') ||
      profileDir.split('\\').some((part) => part === '.' || part === '..') ||
      path.win32.normalize(profileDir) !== profileDir ||
      path.win32.parse(profileDir).root === profileDir
    )
      fail();
    const u = new URL(h.url);
    const token = new URLSearchParams(u.hash.slice(1)).get('invitation');
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(token ?? '') ||
      Buffer.from(token, 'base64url').length !== 32 ||
      Buffer.from(token, 'base64url').toString('base64url') !== token ||
      h.url !== WEB_ORIGIN + '/signup#invitation=' + token ||
      createHash('sha256').update(token, 'ascii').digest('hex') !== h.tokenSha256
    )
      fail();
    // Copy before the first await; callers cannot rebind a live operation.
    return Object.freeze({
      handoff: Object.freeze({ ...h }),
      acknowledgement: Object.freeze({ ...ack }),
      deadline,
      coreUrl,
      coreTreeSha256,
      executablePath,
      profileDir,
    });
  } catch {
    return fail();
  }
}

/** No unapproved navigation origin, external fetch, credentials-in-URL or websocket. */
export function permitsBrowserRequest(raw, navigation) {
  try {
    const u = new URL(raw);
    if (u.username || u.password || u.protocol !== 'http:') return false;
    if (u.origin === WEB_ORIGIN) return true;
    return !navigation && u.origin === AUTH_ORIGIN && u.pathname.startsWith('/auth/v1/');
  } catch {
    return false;
  }
}

/** Public Playwright APIs only. Root wrapper owns the new profile ACL and Windows Job.
 * No logging, HTTP activation fallback, tracing, screenshot, cookie read/export or file output.
 * On failure the result is static and redacted. The wrapper must close its Job on every exit.
 */
export async function runBrowserRegistration(input, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const mono = dependencies.monotonic ?? (() => Number(process.hrtime.bigint() / 1000000n));
  const schedule = dependencies.setTimer ?? setTimeout;
  const unschedule = dependencies.clearTimer ?? clearTimeout;
  const load = dependencies.loadCore ?? ((url) => import(url));
  const environment = dependencies.environment ?? process.env;
  const assertFreshProfile =
    dependencies.assertFreshProfile ??
    ((directory) => {
      if (fs.existsSync(directory)) fail();
      const parent = fs.lstatSync(path.win32.dirname(directory));
      if (!parent.isDirectory() || parent.isSymbolicLink()) fail();
    });
  let validated, admittedAt, admittedMono, proofSink;
  try {
    if (
      (dependencies.platform ?? process.platform) !== 'win32' ||
      typeof input.proofSink !== 'function'
    )
      fail();
    if (
      [
        'DEBUG',
        'DEBUG_FILE',
        'PWDEBUG',
        'npm_config_pwdebug',
        'npm_package_config_pwdebug',
        'NODE_OPTIONS',
        'NODE_DEBUG',
        'CHROME_LOG_FILE',
      ].some((key) => environment[key])
    )
      fail();
    admittedAt = now();
    admittedMono = mono();
    validated = validateRegistrationInput(input, admittedAt);
    assertFreshProfile(validated.profileDir);
    proofSink = input.proofSink;
  } catch {
    return Object.freeze({
      status: 'unresolved',
      code: 'AUTH_BROWSER_INPUT_INVALID',
    });
  }
  const { handoff: h, acknowledgement: ack, deadline } = validated;
  const monotonicEnd = admittedMono + deadline - admittedAt;
  let context,
    page,
    stopped = false,
    boundaryViolation = false,
    timer;
  const left = () => Math.min(deadline - now(), monotonicEnd - mono());
  const check = () => {
    if (
      stopped ||
      boundaryViolation ||
      !Number.isFinite(left()) ||
      left() <= 0 ||
      now() < admittedAt
    )
      throw new Error('AUTH_BROWSER_UNRESOLVED');
  };
  const options = () => {
    check();
    return { timeout: Math.max(1, Math.floor(left())) };
  };
  const step = async (operation) => {
    check();
    const value = await operation();
    check();
    return value;
  };
  let closePromise;
  const close = () => {
    if (context)
      closePromise ??= Promise.resolve().then(() =>
        context.close({ reason: 'Bounded private Auth consumer completed' }),
      );
    return closePromise;
  };
  const timeout = new Promise((_, reject) => {
    timer = schedule(
      () => {
        stopped = true;
        void close()?.catch(() => {});
        reject(new Error('AUTH_BROWSER_UNRESOLVED'));
      },
      Math.max(1, Math.floor(left())),
    );
  });
  const work = async () => {
    const core = await step(() => load(validated.coreUrl));
    const launched = core.chromium.launchPersistentContext(validated.profileDir, {
      executablePath: validated.executablePath,
      headless: true,
      chromiumSandbox: true,
      acceptDownloads: false,
      serviceWorkers: 'block',
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 900 },
    });
    // A late launch after a timeout is still owned and must be closed.
    context = await launched;
    if (stopped) {
      await close();
      throw new Error('AUTH_BROWSER_UNRESOLVED');
    }
    check();
    context.setDefaultTimeout(Math.max(1, Math.floor(left())));
    context.setDefaultNavigationTimeout(Math.max(1, Math.floor(left())));
    await step(() =>
      context.route('**/*', async (route) => {
        try {
          if (
            !permitsBrowserRequest(route.request().url(), route.request().isNavigationRequest())
          ) {
            boundaryViolation = true;
            await route.abort('blockedbyclient');
          } else await route.continue();
        } catch {
          boundaryViolation = true;
        }
      }),
    );
    await step(() =>
      context.routeWebSocket('**/*', (socket) => {
        boundaryViolation = true;
        try {
          socket.close();
        } catch {
          /* no raw transport error */
        }
      }),
    );
    const pages = context.pages();
    if (pages.length > 1 || pages.some((p) => p.url() !== 'about:blank'))
      throw new Error('AUTH_BROWSER_UNRESOLVED');
    page = pages[0] ?? (await step(() => context.newPage()));
    context.on('page', (extra) => {
      if (extra !== page) {
        boundaryViolation = true;
        try {
          void extra.close().catch(() => {});
        } catch {
          /* no raw transport error */
        }
      }
    });
    page.on('dialog', (dialog) => {
      boundaryViolation = true;
      try {
        void dialog.dismiss().catch(() => {});
      } catch {
        /* no raw page error */
      }
    });
    page.on('framenavigated', (frame) => {
      try {
        if (frame.url() !== 'about:blank' && new URL(frame.url()).origin !== WEB_ORIGIN)
          boundaryViolation = true;
      } catch {
        boundaryViolation = true;
      }
    });
    await step(() => page.goto(h.url, { ...options(), waitUntil: 'domcontentloaded' }));
    const invited = page.getByLabel('Invited email address', { exact: true });
    const accepted = page.getByLabel('Accepted name', { exact: true });
    await step(() => invited.waitFor({ ...options(), state: 'visible' }));
    if (
      (await step(() => invited.inputValue(options()))) !== h.email ||
      (await step(() => accepted.inputValue(options()))) !== h.displayName ||
      (await step(() => invited.getAttribute('readonly', options()))) === null ||
      (await step(() => accepted.getAttribute('readonly', options()))) === null
    )
      throw new Error('AUTH_BROWSER_UNRESOLVED');
    await step(() =>
      page.waitForURL(
        (u) => u.origin === WEB_ORIGIN && u.pathname === '/signup' && !u.hash && !u.search,
        options(),
      ),
    );
    const password = page.getByLabel('Password', { exact: true });
    const confirmation = page.getByLabel('Confirm password', { exact: true });
    if (
      (await step(() => password.getAttribute('type', options()))) !== 'password' ||
      (await step(() => confirmation.getAttribute('type', options()))) !== 'password'
    )
      throw new Error('AUTH_BROWSER_UNRESOLVED');
    await step(() => password.fill(h.password, options()));
    await step(() => confirmation.fill(h.password, options()));
    await step(() =>
      page.getByRole('button', { name: 'Activate account', exact: true }).click(options()),
    );
    await step(() =>
      page
        .getByRole('heading', { name: 'Your account is ready', exact: true })
        .waitFor({ ...options(), state: 'visible' }),
    );
    await step(() =>
      page.getByRole('link', { name: 'Continue to sign in', exact: true }).click(options()),
    );
    await step(() =>
      page.waitForURL(
        (u) => u.origin === WEB_ORIGIN && u.pathname === '/login' && !u.hash && !u.search,
        options(),
      ),
    );
    await step(() => page.getByLabel('Email', { exact: true }).fill(h.email, options()));
    await step(() => page.getByLabel('Password', { exact: true }).fill(h.password, options()));
    await step(() =>
      Promise.all([
        page.waitForURL(
          (u) => u.origin === WEB_ORIGIN && u.pathname === '/app' && !u.hash,
          options(),
        ),
        page.getByRole('button', { name: 'Sign in', exact: true }).click(options()),
      ]),
    );
    await step(() => page.getByLabel('Open account menu', { exact: true }).click(options()));
    await step(() =>
      page
        .getByRole('heading', { name: h.displayName, exact: true })
        .waitFor({ ...options(), state: 'visible' }),
    );
    await step(() =>
      page
        .getByRole('button', { name: 'Sign out', exact: true })
        .waitFor({ ...options(), state: 'visible' }),
    );
    const proof = Object.freeze({
      version: ack.version,
      scopeSha256: ack.scopeSha256,
      sourceLockSha256: ack.sourceLockSha256,
      nonce: ack.nonce,
      issueRequestId: ack.issueRequestId,
      tokenSha256: ack.tokenSha256,
      origin: ack.origin,
      email: ack.email,
      cohortId: ack.cohortId,
      observedAt: now(),
      browser: 'chrome',
      checks: Object.freeze({
        fragmentRemoved: true,
        inviteEmailFixed: true,
        activationSucceeded: true,
        ordinaryLoginSucceeded: true,
      }),
    });
    await step(() => close());
    await step(() => proofSink(proof));
    return Object.freeze({ status: 'proved', proof });
  };
  try {
    return await Promise.race([work(), timeout]);
  } catch {
    return Object.freeze({
      status: 'unresolved',
      code: 'AUTH_BROWSER_UNRESOLVED',
    });
  } finally {
    stopped = true;
    unschedule(timer);
    // Initiate closure on every partial failure; the outer Windows Job is the hard backstop.
    void close()?.catch(() => {});
  }
}

// Explicit source entry only. The Job owner withholds the frame until assignment.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--consume-private-stdin') {
    process.stderr.write('AUTH_BROWSER_MODE_REQUIRED\n');
    process.exitCode = 1;
  } else {
    Promise.resolve()
      .then(async () => {
        const input = await readPrivateRegistrationInput(process.stdin, 4096);
        const result = await runBrowserRegistration({
          ...input,
          proofSink: (proof) =>
            new Promise((resolve, reject) =>
              process.stdout.write(JSON.stringify(proof) + '\n', (error) =>
                error ? reject(new Error('AUTH_BROWSER_UNRESOLVED')) : resolve(),
              ),
            ),
        });
        if (result.status !== 'proved') throw new Error('AUTH_BROWSER_UNRESOLVED');
      })
      .catch(() => {
        process.stderr.write('AUTH_BROWSER_UNRESOLVED\n');
        process.exitCode = 1;
      });
  }
}
