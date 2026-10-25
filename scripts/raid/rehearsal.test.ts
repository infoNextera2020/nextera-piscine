import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertRehearsalDatabaseTarget,
  assertRehearsalTemplates,
  parseExampleEnvironment,
  type RaidRehearsalPlan,
} from './rehearsal';

const folder = new URL('../../infra/raid-rehearsal/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, folder), 'utf8');
const plan = JSON.parse(read('plan.json')) as RaidRehearsalPlan;
const compose = read('compose.rehearsal.override.yml'),
  environment = read('environment.example');
const target = `postgresql://fixture-user@127.0.0.1:56522/${plan.database}`;

describe('code-only Raid rehearsal preparation', () => {
  it('validates the committed preparation without declaring execution or live proof', () => {
    expect(assertRehearsalTemplates(plan, compose, environment)).toEqual({
      prepared: true,
      executionAuthorized: false,
      composeRendered: false,
      liveStorageVerified: false,
    });
  });
  it('requires all private inputs to remain blank', () => {
    expect(() =>
      assertRehearsalTemplates(
        plan,
        compose,
        environment.replace('JWT_SECRET=', 'JWT_SECRET=not-a-real-key'),
      ),
    ).toThrow('EXAMPLE_MUST_NOT_CONTAIN_CREDENTIALS');
  });
  it('rejects duplicate environment keys instead of silently overriding a binding', () => {
    expect(() => parseExampleEnvironment(environment + '\nPOSTGRES_DB=postgres\n')).toThrow(
      'EXAMPLE_ENVIRONMENT_INVALID',
    );
  });
  it('does not allow execution approval to be inferred from this code-only plan', () => {
    expect(() =>
      assertRehearsalTemplates({ ...plan, execution_authorized: true }, compose, environment),
    ).toThrow('REHEARSAL_SCOPE_INVALID');
  });
  it('keeps the three-member roster and bounded temporary access scope', () => {
    expect(() => assertRehearsalTemplates({ ...plan, team_size: 4 }, compose, environment)).toThrow(
      'REHEARSAL_ACCESS_INVALID',
    );
    expect(() =>
      assertRehearsalTemplates({ ...plan, worker_token_max_seconds: 7200 }, compose, environment),
    ).toThrow('REHEARSAL_ACCESS_INVALID');
    expect(() =>
      assertRehearsalTemplates({ ...plan, required_future_approvals: [] }, compose, environment),
    ).toThrow('REHEARSAL_APPROVALS_INVALID');
  });
  it('rejects a split Storage database', () => {
    expect(() =>
      assertRehearsalTemplates(
        plan,
        compose.replace(
          'supabase_storage_admin:${POSTGRES_PASSWORD:?Fresh fixture credentials require approval}@db:5432/' +
            plan.database,
          'supabase_storage_admin:${POSTGRES_PASSWORD:?Fresh fixture credentials require approval}@db:5432/postgres',
        ),
        environment,
      ),
    ).toThrow('REHEARSAL_COLOCATION_INVALID');
  });
  it('rejects public exposure or inherited pooler ports', () => {
    expect(() =>
      assertRehearsalTemplates(
        plan,
        compose.replace('127.0.0.1:56521:8000', '0.0.0.0:56521:8000'),
        environment,
      ),
    ).toThrow('REHEARSAL_PORTS_INVALID');
    expect(() =>
      assertRehearsalTemplates(
        plan,
        compose.replace('ports: !override []', 'ports: []'),
        environment,
      ),
    ).toThrow('REHEARSAL_PORTS_INVALID');
  });
  it('rejects reused container names', () => {
    expect(() =>
      assertRehearsalTemplates(
        plan,
        compose.replace(
          'container_name: nextera-raid-rehearsal-auth',
          'container_name: supabase-auth',
        ),
        environment,
      ),
    ).toThrow('REHEARSAL_ISOLATION_INVALID');
  });
  it('accepts only the newly reserved fixture database target', () => {
    expect(assertRehearsalDatabaseTarget(target, plan).pathname).toBe('/' + plan.database);
  });
  it.each([
    'postgresql://fixture-user@127.0.0.1:54322/postgres',
    'postgresql://fixture-user@127.0.0.1:55439/foundation_test_vertical_20261025',
    'postgresql://fixture-user@127.0.0.1:56522/postgres',
    'postgresql://fixture-user@remote.example:56522/' + plan.database,
    target + '?host=remote.example',
    'not-a-connection-string',
  ])('rejects retained, remote or ambiguous target %#', (value) => {
    expect(() => assertRehearsalDatabaseTarget(value, plan)).toThrow('PREFLIGHT_TARGET_INVALID');
  });
});
