import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
const root = new URL('../', import.meta.url);
async function http(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'manual' });
    await response.body?.cancel();
    return { url, status: response.status };
  } catch {
    return { url, status: null };
  }
}
function tcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(value);
      }
    };
    socket.setTimeout(1500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
const [auth, builtApp, samplePortal, componentFixture, postgres] = await Promise.all([
  http('http://127.0.0.1:54321/auth/v1/health'),
  http('http://127.0.0.1:3104/login'),
  http('http://127.0.0.1:3103/login'),
  http('http://127.0.0.1:3118/app'),
  tcp(55439),
]);
const manifest = parse(
  await readFile(new URL('content/piscine-v1/manifest.yaml', root), 'utf8'),
) as { status?: string; version?: string; quests?: unknown[]; nodes?: unknown[] };
const candidate = JSON.parse(
  await readFile(new URL('infra/runner/catalog/candidate.json', root), 'utf8'),
) as {
  status?: string;
  catalog?: { test_packs?: Record<string, { test_pack_artifact?: unknown }> };
};
const packs = Object.values(candidate.catalog?.test_packs ?? {});
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      checkout: fileURLToPath(root),
      mode: 'read-only loopback diagnostics; no credentials read and no services started',
      services: {
        auth,
        builtApp,
        samplePortal,
        componentFixture: { ...componentFixture, fixtureOnly: true },
        isolatedPostgres: { host: '127.0.0.1', port: 55439, tcpReachable: postgres },
      },
      source: {
        status: manifest.status,
        version: manifest.version,
        quests: manifest.quests?.length ?? 0,
        nodes: manifest.nodes?.length ?? 0,
      },
      evaluationCatalog: {
        status: candidate.status,
        entries: packs.length,
        missingPrivateArtifactReferences: packs.filter((p) => !p.test_pack_artifact).length,
      },
      notVerified: [
        'Authenticated learner access',
        'Database identity/permissions or SQL health',
        'Runner or pack integrity',
        'End-to-end evaluation/progression',
        'Production readiness',
      ],
      next: 'Use the documented local service startup path. Fresh fixture credentials require separate approval; never reactivate cleaned access. See docs/THURSDAY_DEMO_READINESS_2026_10_29.md.',
    },
    null,
    2,
  ),
);
