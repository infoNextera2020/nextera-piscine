import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  reconcile: vi.fn(),
  checkpoints: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('@nextera/db/connection', () => ({ createDatabase: mocks.connect }));
vi.mock('@nextera/db/operations/results', () => ({
  applyResult: mocks.apply,
  reconcileResults: mocks.reconcile,
}));
vi.mock('@nextera/db/operations/checkpoints', () => ({ reconcileCheckpoints: mocks.checkpoints }));
import { serviceApplication } from './application';
const token = 'f'.repeat(64);
const request = (body: unknown, authorized = true) =>
  new Request('http://localhost/api/internal/results', {
    method: 'POST',
    headers: authorized
      ? { authorization: `Bearer ${token}` }
      : { cookie: 'learner-session=ordinary-user' },
    body: JSON.stringify(body),
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('dedicated result service authentication', () => {
  it('rejects learner cookies before opening any database', async () => {
    vi.stubEnv('RESULT_APPLICATION_SERVICE_TOKEN', token);
    expect(
      (await serviceApplication(request({ result_id: randomUUID() }, false), false)).status,
    ).toBe(401);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each([
    'verdict',
    'submission_id',
    'node_key',
    'curriculum_version_id',
    'attempt_number',
    'evaluation_digest',
    'prerequisites',
    'unlock_nodes',
  ])('rejects caller supplied %s', async (field) => {
    vi.stubEnv('RESULT_APPLICATION_SERVICE_TOKEN', token);
    expect(
      (await serviceApplication(request({ result_id: randomUUID(), [field]: 'untrusted' }), false))
        .status,
    ).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('passes only result identity to the trusted service', async () => {
    vi.stubEnv('RESULT_APPLICATION_SERVICE_TOKEN', token);
    vi.stubEnv('RESULT_APPLICATION_DATABASE_URL', 'dedicated-test-connection');
    const id = randomUUID();
    mocks.connect.mockReturnValue({ db: {}, close: mocks.close });
    mocks.apply.mockResolvedValue({ id, application_status: 'applied' });
    const response = await serviceApplication(request({ result_id: id }), false);
    expect(await response.json()).toEqual({ result_id: id, status: 'applied' });
    expect(mocks.apply).toHaveBeenCalledWith({}, id);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('surfaces reconciliation failures for operator attention without exposing errors', async () => {
    vi.stubEnv('RESULT_APPLICATION_SERVICE_TOKEN', token);
    vi.stubEnv('RESULT_APPLICATION_DATABASE_URL', 'dedicated-test-connection');
    mocks.connect.mockReturnValue({ db: {}, close: mocks.close });
    mocks.reconcile.mockResolvedValue([{ id: randomUUID(), status: 'attention_required' }]);
    mocks.checkpoints.mockResolvedValue([]);
    expect((await serviceApplication(request({}), true)).status).toBe(409);
  });
});
