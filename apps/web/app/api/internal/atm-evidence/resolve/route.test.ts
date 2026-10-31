import { describe, expect, it, vi } from 'vitest';
const handler = vi.hoisted(() => vi.fn(async () => new Response('safe fake result')));
vi.mock('../../../../../lib/atm-evidence/server', () => ({ handleAtmEvidenceRequest: handler }));
import * as resolve from './route';
import * as retain from '../retain/route';
import * as reconcile from '../reconcile/route';
describe('actual protected ATM route assembly', () => {
  it.each([
    ['resolve', resolve],
    ['retain', retain],
    ['reconcile', reconcile],
  ] as const)('wires %s into the protected server adapter', async (operation, route) => {
    handler.mockClear();
    const request = new Request('http://internal.invalid/api/internal/atm-evidence/' + operation, {
      method: 'POST',
    });
    expect(await (await route.POST(request)).text()).toBe('safe fake result');
    expect(handler).toHaveBeenCalledExactlyOnceWith(request, operation, process.env);
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
  });
});
