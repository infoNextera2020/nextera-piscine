import { parse } from 'yaml';
export type RaidRehearsalPlan = {
  status: string;
  execution_authorized: boolean;
  project: string;
  database: string;
  database_host: string;
  database_port: number;
  api_url: string;
  application_url: string;
  upstream_release: string;
  team_size: number;
  test_auth_identities: { learners: number; mentor: number; owner: number };
  worker_token_max_seconds: number;
  retained_database_access: boolean;
  catalog_publication: boolean;
  required_future_approvals: string[];
};
const retainedPorts = new Set([54321, 54322, 55439, 55442, 3100, 3103, 3104, 3118]);
export function assertRehearsalPlan(plan: RaidRehearsalPlan) {
  if (
    plan.status !== 'PREPARED_NOT_STARTED' ||
    plan.execution_authorized !== false ||
    plan.retained_database_access !== false ||
    plan.catalog_publication !== false
  )
    throw new Error('REHEARSAL_SCOPE_INVALID');
  if (
    plan.project !== 'nextera-raid-rehearsal' ||
    !/^foundation_test_raid_rehearsal_[0-9]{8}$/.test(plan.database) ||
    plan.database_host !== '127.0.0.1' ||
    plan.database_port !== 56522 ||
    retainedPorts.has(plan.database_port)
  )
    throw new Error('REHEARSAL_TARGET_INVALID');
  if (
    plan.api_url !== 'http://127.0.0.1:56521' ||
    plan.application_url !== 'http://127.0.0.1:3150' ||
    plan.upstream_release !== 'self-hosted/v0.8.3'
  )
    throw new Error('REHEARSAL_CONFIGURATION_INVALID');
  if (
    plan.team_size !== 3 ||
    plan.test_auth_identities.learners !== 3 ||
    plan.test_auth_identities.mentor !== 1 ||
    plan.test_auth_identities.owner !== 1 ||
    plan.worker_token_max_seconds !== 3600
  )
    throw new Error('REHEARSAL_ACCESS_INVALID');
  if (
    ![
      'isolated_service_bootstrap',
      'isolated_migrations',
      'temporary_access',
      'live_rehearsal',
    ].every((scope) => plan.required_future_approvals.includes(scope))
  )
    throw new Error('REHEARSAL_APPROVALS_INVALID');
}
export function parseExampleEnvironment(text: string) {
  const env: Record<string, string> = {};
  for (const line of text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(env, match[1]!)) throw new Error('EXAMPLE_ENVIRONMENT_INVALID');
    env[match[1]!] = match[2]!;
  }
  return env;
}
export function assertRehearsalTemplates(
  plan: RaidRehearsalPlan,
  compose: string,
  environment: string,
) {
  assertRehearsalPlan(plan);
  const env = parseExampleEnvironment(environment);
  for (const key of [
    'POSTGRES_PASSWORD',
    'JWT_SECRET',
    'ANON_KEY',
    'SERVICE_ROLE_KEY',
    'PG_META_CRYPTO_KEY',
    'SECRET_KEY_BASE',
    'REALTIME_DB_ENC_KEY',
    'VAULT_ENC_KEY',
    'DASHBOARD_PASSWORD',
    'S3_PROTOCOL_ACCESS_KEY_ID',
    'S3_PROTOCOL_ACCESS_KEY_SECRET',
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'OPERATIONS_DATABASE_URL',
    'RAID_PREFLIGHT_DATABASE_URL',
    'RESULT_APPLICATION_DATABASE_URL',
    'RESULT_APPLICATION_SERVICE_TOKEN',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ])
    if (env[key] !== '') throw new Error('EXAMPLE_MUST_NOT_CONTAIN_CREDENTIALS');
  if (
    env.POSTGRES_DB !== plan.database ||
    env.RAID_STORAGE_DATABASE_NAME !== plan.database ||
    env.RAID_STORAGE_API_URL !== plan.api_url ||
    env.NEXT_PUBLIC_SUPABASE_URL !== plan.api_url ||
    env.DISABLE_SIGNUP !== 'true'
  )
    throw new Error('REHEARSAL_BINDING_INVALID');
  // Validate template data only. This does not simulate Docker's !override merge or start a daemon.
  const config = parse(compose.replace(/!override\b/g, '')) as {
    name: string;
    services: Record<
      string,
      {
        container_name?: string;
        restart?: string;
        ports?: string[];
        environment?: Record<string, string>;
      }
    >;
  };
  if (config.name !== plan.project) throw new Error('REHEARSAL_PROJECT_INVALID');
  const names = new Set<string>();
  const ports: string[] = [];
  const services = [
    'studio',
    'api-gw',
    'auth',
    'rest',
    'realtime',
    'storage',
    'imgproxy',
    'meta',
    'functions',
    'db',
    'supavisor',
  ];
  if (Object.keys(config.services).sort().join(',') !== services.sort().join(','))
    throw new Error('REHEARSAL_SERVICES_INVALID');
  for (const service of Object.values(config.services)) {
    if (
      !service.container_name?.includes(plan.project) ||
      names.has(service.container_name) ||
      service.restart !== 'no'
    )
      throw new Error('REHEARSAL_ISOLATION_INVALID');
    names.add(service.container_name);
    ports.push(...(service.ports ?? []));
  }
  if (
    ports.sort().join(',') !== ['127.0.0.1:56521:8000', '127.0.0.1:56522:5432'].sort().join(',') ||
    (compose.match(/ports: !override/g) ?? []).length !== 3 ||
    config.services.supavisor?.ports?.length !== 0
  )
    throw new Error('REHEARSAL_PORTS_INVALID');
  for (const [service, key] of [
    ['auth', 'GOTRUE_DB_DATABASE_URL'],
    ['storage', 'DATABASE_URL'],
    ['rest', 'PGRST_DB_URI'],
  ] as const)
    if (!config.services[service]?.environment?.[key]?.endsWith('@db:5432/' + plan.database))
      throw new Error('REHEARSAL_COLOCATION_INVALID');
  return {
    prepared: true,
    executionAuthorized: false,
    composeRendered: false,
    liveStorageVerified: false,
  } as const;
}
export function assertRehearsalDatabaseTarget(value: string, plan: RaidRehearsalPlan) {
  assertRehearsalPlan(plan);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PREFLIGHT_TARGET_INVALID');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== plan.database_host ||
    Number(url.port) !== plan.database_port ||
    url.pathname !== '/' + plan.database ||
    url.hash ||
    url.search
  )
    throw new Error('PREFLIGHT_TARGET_INVALID');
  return url;
}
