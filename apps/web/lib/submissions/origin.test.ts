import { expect, it } from 'vitest';
import { sameOrigin } from './origin';
it('accepts the actual browser origin when Next normalizes a loopback URL', () => {
  expect(
    sameOrigin(
      new Request('http://localhost:3100/api/submissions', {
        headers: { host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100' },
      }),
    ),
  ).toBe(true);
});
it('denies cross-site, missing, opaque and malformed Origin headers', () => {
  for (const origin of [
    'https://untrusted.invalid',
    'null',
    'http://127.0.0.1:3100/extra',
    'http://user:password@127.0.0.1:3100',
    '',
  ])
    expect(
      sameOrigin(
        new Request('http://localhost:3100/api/submissions', {
          headers: { host: '127.0.0.1:3100', origin },
        }),
      ),
    ).toBe(false);
});
