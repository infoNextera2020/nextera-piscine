import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import {
  AUTH_ORIGIN,
  WEB_ORIGIN,
  CORE_URL,
  CORE_TREE_SHA256,
  CHROME_PATH,
  parsePrivateHandoffFrame,
  parsePrivateRegistrationFrame,
  readPrivateRegistrationInput,
  readPrivateHandoff,
  validateRegistrationInput,
  permitsBrowserRequest,
  runBrowserRegistration,
} from '../week1-auth-browser-consumer.mjs';

const START = 1793440000000;
function fixture() {
  const token = Buffer.alloc(32, 7).toString('base64url');
  const ack = {
    version: 1,
    scopeSha256: 'a'.repeat(64),
    sourceLockSha256: 'b'.repeat(64),
    nonce: '00000000-0000-0000-0000-000000000001',
    issueRequestId: '00000000-0000-0000-0000-000000000002',
    origin: WEB_ORIGIN,
    cohortId: '00000000-0000-0000-0000-000000000003',
    email: 'week1-b-20261030-invitation1@example.invalid',
    displayName: 'Week 1 Synthetic Learner B',
    expiresAt: START + 900000,
    tokenSha256: createHash('sha256').update(token).digest('hex'),
    issuedAt: START + 1000,
  };
  return {
    handoff: {
      ...ack,
      url: WEB_ORIGIN + '/signup#invitation=' + token,
      password: 'c'.repeat(48),
    },
    expectedScope: ack,
    awaitingStartedAt: START,
    cleanupAt: START + 300000,
    deadline: START + 150000,
    coreUrl: CORE_URL,
    coreTreeSha256: CORE_TREE_SHA256,
    executablePath: CHROME_PATH,
    profileDir: 'C:\\Users\\test\\PrivateBrowserJobUnique\\chrome-profile',
    proofSink: async () => {},
  };
}

function fakeBrowser(input, behavior = {}) {
  const events = [],
    listeners = new Map();
  let url = 'about:blank',
    activated = false,
    login = false;
  let pendingUrl;
  const page = {
    url: () => url,
    on: (name, callback) => {
      listeners.set(name, callback);
    },
    async goto(value) {
      events.push('goto');
      url = value;
      if (behavior.goto) await behavior.goto();
    },
    async waitForURL(predicate) {
      if (url.includes('#invitation=')) url = WEB_ORIGIN + '/signup';
      if (predicate(new URL(url))) return;
      await new Promise((resolve) => {
        pendingUrl = () => {
          assert.ok(predicate(new URL(url)));
          resolve();
        };
      });
    },
    getByLabel(name) {
      return locator(name);
    },
    getByRole(role, options) {
      return locator(options.name, role);
    },
  };
  function locator(name, role) {
    return {
      async waitFor() {
        events.push('visible:' + name);
        if (name === 'Your account is ready') assert.ok(activated);
        if (name === input.handoff.displayName || name === 'Sign out') assert.ok(login);
        if (behavior.failAt === name)
          throw new Error(input.handoff.url + ' ' + input.handoff.password);
      },
      async inputValue() {
        if (name === 'Invited email address')
          return behavior.wrongEmail ? 'wrong@example.invalid' : input.handoff.email;
        if (name === 'Accepted name') return input.handoff.displayName;
        throw new Error('Unexpected private field read');
      },
      async getAttribute(attribute) {
        if (attribute === 'readonly') return behavior.editableIdentity ? null : '';
        if (attribute === 'type') return 'password';
        throw new Error('Unexpected attribute');
      },
      async fill(value) {
        events.push('fill:' + name);
        assert.ok(value === input.handoff.password || value === input.handoff.email);
      },
      async click() {
        events.push('click:' + name);
        if (name === 'Activate account') {
          activated = true;
          if (behavior.activate) await behavior.activate();
        }
        if (name === 'Continue to sign in') url = WEB_ORIGIN + '/login';
        if (name === 'Sign in') {
          assert.ok(activated);
          login = true;
          url = WEB_ORIGIN + '/app';
          pendingUrl?.();
        }
        if (name === 'Open account menu') assert.ok(login);
        assert.ok(role === undefined || role === 'button' || role === 'link');
      },
    };
  }
  const context = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    async route(pattern, handler) {
      assert.equal(pattern, '**/*');
      context.routeHandler = handler;
    },
    async routeWebSocket(pattern, handler) {
      assert.equal(pattern, '**/*');
      context.websocketHandler = handler;
    },
    pages: () => [page],
    on(name, callback) {
      context.listeners.set(name, callback);
    },
    listeners: new Map(),
    async close() {
      events.push('close');
      if (behavior.close) await behavior.close();
    },
  };
  const core = {
    chromium: {
      async launchPersistentContext(profile, options) {
        events.push('launch');
        assert.equal(profile, input.profileDir);
        assert.equal(options.executablePath, CHROME_PATH);
        assert.equal(options.chromiumSandbox, true);
        assert.equal(options.headless, true);
        assert.equal(options.acceptDownloads, false);
        assert.equal(options.serviceWorkers, 'block');
        assert.equal(options.ignoreHTTPSErrors, false);
        assert.equal(options.args, undefined);
        assert.equal(options.recordVideo, undefined);
        if (behavior.launch) await behavior.launch();
        return context;
      },
    },
  };
  const dependencies = {
    platform: 'win32',
    environment: {},
    assertFreshProfile: () => {},
    now: () => START + 2000,
    monotonic: () => 100,
    loadCore: async (value) => {
      assert.equal(value, CORE_URL);
      return core;
    },
  };
  return { events, page, context, listeners, dependencies };
}

test('exact compact private frame; stream bounded; no duplicate keys or extra frames', async () => {
  const h = fixture().handoff,
    bytes = Buffer.from(JSON.stringify(h) + '\n');
  assert.deepEqual(parsePrivateHandoffFrame(bytes, 4096), h);
  assert.deepEqual(
    await readPrivateHandoff(Readable.from([bytes.subarray(0, 30), bytes.subarray(30)]), 4096),
    h,
  );
  for (const invalid of [
    Buffer.from(JSON.stringify(h)),
    Buffer.concat([bytes, bytes]),
    Buffer.from('{"version":2,' + JSON.stringify(h).slice(1) + '\n'),
    Buffer.from('{}\n'),
    Buffer.from([255, 10]),
  ])
    assert.throws(() => parsePrivateHandoffFrame(invalid, 4096), /AUTH_BROWSER_INPUT_INVALID/);
  await assert.rejects(
    readPrivateHandoff(Readable.from([bytes]), 10),
    /AUTH_BROWSER_INPUT_INVALID/,
  );
  assert.throws(() => parsePrivateHandoffFrame(bytes), /AUTH_BROWSER_INPUT_INVALID/);
});

test('scope, exact URL, token hash, B identity, paths and original cutoff are required', () => {
  const input = fixture();
  assert.equal(validateRegistrationInput(input, START + 2000).deadline, START + 150000);
  const changes = [
    (v) => {
      v.handoff.extra = true;
    },
    (v) => {
      v.handoff.scopeSha256 = 'd'.repeat(64);
    },
    (v) => {
      v.handoff.url = v.handoff.url.replace('127.0.0.1', 'localhost');
    },
    (v) => {
      v.handoff.url = v.handoff.url.replace('/signup#', '/signup?x=1#');
    },
    (v) => {
      v.handoff.url = v.handoff.url.replace('/signup#', '/login#');
    },
    (v) => {
      v.handoff.tokenSha256 = v.expectedScope.tokenSha256 = 'd'.repeat(64);
    },
    (v) => {
      v.handoff.email = v.expectedScope.email = 'other@example.invalid';
    },
    (v) => {
      v.handoff.password = 'not the current synthetic password format';
    },
    (v) => {
      v.deadline += 1;
    },
    (v) => {
      v.awaitingStartedAt += 1;
    },
    (v) => {
      v.profileDir = 'C:\\';
    },
    (v) => {
      v.profileDir = '\\\\owner\\browser';
    },
    (v) => {
      v.profileDir = 'C:\\private\\..\\owner';
    },
    (v) => {
      v.profileDir = 'C:\\private:alternate\\profile';
    },
    (v) => {
      v.coreUrl = 'file:///other.mjs';
    },
    (v) => {
      v.executablePath = 'C:\\other.exe';
    },
  ];
  for (const change of changes) {
    const v = fixture();
    change(v);
    assert.throws(() => validateRegistrationInput(v, START + 2000));
  }
  assert.throws(() => validateRegistrationInput(input, START + 150000));
  const copy = validateRegistrationInput(input, START + 2000);
  input.handoff.url = 'changed';
  assert.notEqual(copy.handoff.url, input.handoff.url);
  assert.ok(Object.isFrozen(copy.handoff));
});

test('request boundary permits local web and Auth subrequests, never external navigation', () => {
  assert.ok(permitsBrowserRequest(WEB_ORIGIN + '/signup', true));
  assert.ok(permitsBrowserRequest(AUTH_ORIGIN + '/auth/v1/token?grant_type=password', false));
  for (const [url, navigation] of [
    [AUTH_ORIGIN + '/auth/v1/token', true],
    [AUTH_ORIGIN + '/rest/v1/users', false],
    ['http://localhost:3151/app', true],
    ['http://127.0.0.1:9999/app', false],
    ['https://example.invalid/', false],
    ['http://user:pass@127.0.0.1:3151/app', false],
    ['file:///secret', true],
    ['ws://127.0.0.1:3151/', false],
  ])
    assert.equal(permitsBrowserRequest(url, navigation), false);
});

test('real UI sequence produces exact redacted existing proof only after context closure', async () => {
  const input = fixture(),
    f = fakeBrowser(input);
  let proof;
  input.proofSink = async (value) => {
    assert.equal(f.events.at(-1), 'close');
    proof = value;
  };
  const result = await runBrowserRegistration(input, f.dependencies);
  assert.equal(result.status, 'proved');
  assert.equal(proof.browser, 'chrome');
  assert.equal(Object.keys(proof).length, 12);
  assert.deepEqual(proof.checks, {
    fragmentRemoved: true,
    inviteEmailFixed: true,
    activationSucceeded: true,
    ordinaryLoginSucceeded: true,
  });
  assert.ok(f.events.indexOf('click:Activate account') < f.events.indexOf('click:Sign in'));
  assert.ok(f.events.includes('visible:' + input.handoff.displayName));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(input.handoff.password));
  assert.ok(!serialized.includes(input.handoff.url));
  assert.equal(f.events.filter((x) => x === 'close').length, 1);
});

test('partial UI failure, editable/wrong identity, raw transport errors never emit a proof', async () => {
  for (const behavior of [
    { wrongEmail: true },
    { editableIdentity: true },
    { failAt: 'Your account is ready' },
    {
      close: async () => {
        throw new Error('secret raw close error');
      },
    },
  ]) {
    const input = fixture(),
      f = fakeBrowser(input, behavior);
    let writes = 0;
    input.proofSink = async () => {
      writes++;
    };
    const result = await runBrowserRegistration(input, f.dependencies);
    assert.deepEqual(result, {
      status: 'unresolved',
      code: 'AUTH_BROWSER_UNRESOLVED',
    });
    assert.equal(writes, 0);
    assert.ok(f.events.includes('close'));
    assert.ok(!JSON.stringify(result).includes(input.handoff.password));
  }
});

test('forbidden network or popup marks unresolved and closes the private context', async () => {
  for (const kind of ['network', 'popup', 'websocket']) {
    const input = fixture();
    let f,
      aborted = 0,
      extraClosed = 0;
    f = fakeBrowser(input, {
      activate: async () => {
        if (kind === 'network')
          await f.context.routeHandler({
            request: () => ({
              url: () => 'https://example.invalid/',
              isNavigationRequest: () => true,
            }),
            abort: async () => {
              aborted++;
            },
            continue: async () => assert.fail('blocked route continued'),
          });
        if (kind === 'popup')
          f.context.listeners.get('page')({
            close: async () => {
              extraClosed++;
            },
          });
        if (kind === 'websocket')
          f.context.websocketHandler({
            close: () => {
              extraClosed++;
            },
          });
      },
    });
    const result = await runBrowserRegistration(input, f.dependencies);
    assert.equal(result.status, 'unresolved');
    assert.ok(f.events.includes('close'));
    assert.equal(aborted + extraClosed, 1);
  }
});

test('wall reversal and monotonic expiry cannot renew the original shared deadline', async () => {
  for (const mode of ['wall', 'mono']) {
    const input = fixture();
    let wall = START + 2000,
      monotonic = 100;
    const f = fakeBrowser(input, {
      activate: async () => {
        if (mode === 'wall') wall--;
        else monotonic += 150000;
      },
    });
    f.dependencies.now = () => wall;
    f.dependencies.monotonic = () => monotonic;
    assert.equal((await runBrowserRegistration(input, f.dependencies)).status, 'unresolved');
    assert.ok(f.events.includes('close'));
    assert.ok(!f.events.includes('click:Sign in'));
  }
});

test('timeout closes a late launch, without publishing a proof or another operation', async () => {
  const input = fixture();
  let release,
    fire,
    writes = 0;
  input.proofSink = async () => {
    writes++;
  };
  const f = fakeBrowser(input, {
    launch: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  f.dependencies.setTimer = (callback) => {
    fire = callback;
    return 1;
  };
  f.dependencies.clearTimer = () => {};
  const running = runBrowserRegistration(input, f.dependencies);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  fire();
  assert.equal((await running).status, 'unresolved');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 0);
  assert.deepEqual(f.events, ['launch', 'close']);
});

test('invalid input never imports core or launches; import itself has no startup side effects', async () => {
  const input = fixture();
  input.handoff.password = 'invalid';
  const result = await runBrowserRegistration(input, {
    platform: 'win32',
    now: () => START + 2000,
    loadCore: async () => assert.fail('invalid input imported browser core'),
  });
  assert.deepEqual(result, {
    status: 'unresolved',
    code: 'AUTH_BROWSER_INPUT_INVALID',
  });
  assert.equal(
    (
      await runBrowserRegistration(fixture(), {
        platform: 'linux',
        now: () => START + 2000,
      })
    ).status,
    'unresolved',
  );
});

test('private consumer envelope is one bounded nine-field frame without a callback or argv secret', async () => {
  const frame = { ...fixture() };
  delete frame.proofSink;
  const bytes = Buffer.from(JSON.stringify(frame) + '\n');
  assert.ok(bytes.length < 4096);
  assert.equal(Object.keys(frame).length, 9);
  assert.deepEqual(parsePrivateRegistrationFrame(bytes, 4096), frame);
  assert.deepEqual(await readPrivateRegistrationInput(Readable.from([bytes]), 4096), frame);
  for (const value of [
    { ...frame, cookieFile: 'forbidden' },
    { ...frame, handoff: { ...frame.handoff, rawKey: 'forbidden' } },
  ])
    assert.throws(() =>
      parsePrivateRegistrationFrame(Buffer.from(JSON.stringify(value) + '\n'), 4096),
    );
});

test('missing or changed source-bound Core tree digest fails before browser import', async () => {
  for (const value of [undefined, '0'.repeat(64)]) {
    const input = fixture(),
      f = fakeBrowser(input);
    if (value === undefined) delete input.coreTreeSha256;
    else input.coreTreeSha256 = value;
    const result = await runBrowserRegistration(input, f.dependencies);
    assert.equal(result.code, 'AUTH_BROWSER_INPUT_INVALID');
    assert.deepEqual(f.events, []);
  }
});

test('diagnostic/preload environment and a reused profile fail before importing browser core', async () => {
  for (const key of [
    'DEBUG',
    'DEBUG_FILE',
    'PWDEBUG',
    'npm_config_pwdebug',
    'npm_package_config_pwdebug',
    'NODE_OPTIONS',
    'NODE_DEBUG',
    'CHROME_LOG_FILE',
  ]) {
    const input = fixture();
    const f = fakeBrowser(input);
    f.dependencies.environment = { [key]: 'fake-never-enabled' };
    assert.equal(
      (await runBrowserRegistration(input, f.dependencies)).code,
      'AUTH_BROWSER_INPUT_INVALID',
    );
    assert.deepEqual(f.events, []);
  }
  const input = fixture(),
    f = fakeBrowser(input);
  f.dependencies.assertFreshProfile = () => {
    throw new Error('existing profile');
  };
  assert.equal(
    (await runBrowserRegistration(input, f.dependencies)).code,
    'AUTH_BROWSER_INPUT_INVALID',
  );
  assert.deepEqual(f.events, []);
});

test('explicit CLI rejects an invalid private frame with only a fixed safe error', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../week1-auth-browser-consumer.mjs', import.meta.url)),
      '--consume-private-stdin',
    ],
    {
      input: '{"private":"fake-never-real"}\n',
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 4096,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'AUTH_BROWSER_UNRESOLVED\n');
});
