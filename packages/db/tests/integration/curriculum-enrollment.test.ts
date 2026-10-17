import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../schema/index';
import { importCurriculum, type OperationalDatabase } from '../../operations/curriculum';
import { createCohort, enrollLearner, pinCohort } from '../../operations/cohorts';
import { testCurriculum } from '../../../../tests/fixtures/curriculum';
import { parseCurriculum } from '../../../../scripts/curriculum/load';
import { evaluationDigest } from '../../../../scripts/curriculum/digest';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
let client: ReturnType<typeof postgres>;
let db: OperationalDatabase;
const fixture = testCurriculum();
let versionId: string;
let cohortId: string;
let learnerId: string;
const startsAt = new Date('2026-11-20T00:00:00Z');
async function user(role = 'learner', active = true) {
  const authId = randomUUID();
  await client`INSERT INTO auth.users(id) VALUES (${authId})`;
  const [row] =
    await client`INSERT INTO app.users(auth_user_id,display_name,role,active) VALUES (${authId},'TEST ONLY',${role},${active}) RETURNING id`;
  return String(row!.id);
}
const cohortInput = (id: string) => ({
  slug: `foundation-test-${randomUUID()}`,
  name: 'ISOLATED TEST COHORT',
  curriculumVersionId: id,
  startsAt,
});

beforeAll(async () => {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection) throw new Error('TEST_DATABASE_URL required.');
  const url = new URL(connection);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.startsWith('/foundation_test')
  )
    throw new Error('Disposable local foundation_test database required.');
  client = postgres(connection, { max: 4, prepare: false, onnotice: () => {} });
  await client.unsafe('CREATE SCHEMA IF NOT EXISTS auth');
  await client.unsafe('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  db = drizzle(client, { schema });
  const options = { migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)) };
  await migrate(db, options);
  await migrate(db, options);
  versionId = (
    await importCurriculum(db, fixture.curriculum, fixture.gitCommitSha, fixture.evaluations)
  ).id;
  cohortId = (await createCohort(db, cohortInput(versionId))).id;
  learnerId = await user();
});
afterAll(async () => {
  if (client) await client.end();
});

describe('immutable publication and enrollment operations', () => {
  it('imports an idempotent draft receipt without incomplete node projections', async () => {
    const draft = testCurriculum();
    const a = await importCurriculum(db, draft.curriculum, draft.gitCommitSha);
    const b = await importCurriculum(db, draft.curriculum, draft.gitCommitSha);
    expect(a.id).toBe(b.id);
    expect(a.status).toBe('draft');
    expect(
      await client`SELECT node_key FROM app.curriculum_nodes WHERE curriculum_version_id=${a.id}`,
    ).toHaveLength(0);
    await expect(createCohort(db, cohortInput(a.id))).rejects.toThrow(/published/);
    await expect(
      client`UPDATE app.curriculum_versions SET status='published', published_at=now() WHERE id=${a.id}`,
    ).rejects.toMatchObject({ code: 'P0001' });
  });
  it('publishes a complete test-only projection and repeats without rewriting it', async () => {
    const again = await importCurriculum(
      db,
      fixture.curriculum,
      fixture.gitCommitSha,
      fixture.evaluations,
    );
    expect(again.id).toBe(versionId);
    expect(again.status).toBe('published');
    expect(
      await client`SELECT node_key FROM app.curriculum_nodes WHERE curriculum_version_id=${versionId}`,
    ).toHaveLength(2);
    expect(
      await client`SELECT * FROM app.node_prerequisites WHERE curriculum_version_id=${versionId}`,
    ).toHaveLength(1);
  });
  it('rejects changed bytes or evaluation identity under an existing version', async () => {
    const changed = parseCurriculum(
      fixture.files.map((file) =>
        file.path.endsWith('hello-go/subject.md')
          ? { ...file, bytes: Buffer.concat([Buffer.from(file.bytes), Buffer.from('\nChanged')]) }
          : file,
      ),
    );
    await expect(
      importCurriculum(db, changed, fixture.gitCommitSha, fixture.evaluations),
    ).rejects.toThrow(/different content/);
    const evaluations = fixture.evaluations.map((e) => {
      const spec = { ...e.spec, resource_profile: 'CHANGED-TEST-POLICY' };
      return { ...e, spec, digest: evaluationDigest(spec) };
    });
    await expect(
      importCurriculum(db, fixture.curriculum, fixture.gitCommitSha, evaluations),
    ).rejects.toThrow(/evaluation identity differs/);
  });
  it.each([
    'UPDATE app.curriculum_versions SET content_digest=content_digest WHERE id=$1',
    'DELETE FROM app.curriculum_versions WHERE id=$1',
    "UPDATE app.quests SET title='changed' WHERE curriculum_version_id=$1",
    "INSERT INTO app.quests VALUES ($1,'extra','Extra',2)",
    'DELETE FROM app.quests WHERE curriculum_version_id=$1',
    "UPDATE app.curriculum_nodes SET subject_markdown='changed' WHERE curriculum_version_id=$1",
    'DELETE FROM app.curriculum_nodes WHERE curriculum_version_id=$1',
    'DELETE FROM app.node_prerequisites WHERE curriculum_version_id=$1',
  ])('prevents published mutation: %s', async (statement) => {
    await expect(client.unsafe(statement, [versionId])).rejects.toMatchObject({ code: 'P0001' });
  });
  it('atomically initializes Hello available and Even or Odd locked', async () => {
    const membership = await enrollLearner(db, cohortId, learnerId);
    const rows =
      await client`SELECT node_key,state,unlocked_at,started_at,mastered_at,first_passing_submission_id FROM app.learner_node_progress WHERE cohort_id=${cohortId} AND user_id=${learnerId} ORDER BY node_key`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      node_key: 'even-or-odd',
      state: 'locked',
      unlocked_at: null,
      started_at: null,
      mastered_at: null,
      first_passing_submission_id: null,
    });
    expect(rows[1]).toMatchObject({
      node_key: 'hello-go',
      state: 'available',
      started_at: null,
      mastered_at: null,
      first_passing_submission_id: null,
    });
    expect(new Date(rows[1]!.unlocked_at).getTime()).toBe(membership.joinedAt.getTime());
  });
  it('keeps concurrent duplicate enrollment idempotent without resetting timestamps', async () => {
    const [before] =
      await client`SELECT unlocked_at FROM app.learner_node_progress WHERE cohort_id=${cohortId} AND user_id=${learnerId} AND node_key='hello-go'`;
    const [a, b] = await Promise.all([
      enrollLearner(db, cohortId, learnerId),
      enrollLearner(db, cohortId, learnerId),
    ]);
    expect(a.joinedAt.getTime()).toBe(b.joinedAt.getTime());
    const rows =
      await client`SELECT unlocked_at FROM app.learner_node_progress WHERE cohort_id=${cohortId} AND user_id=${learnerId} AND node_key='hello-go'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unlocked_at).toEqual(before!.unlocked_at);
  });
  it('rolls back membership when progress initialization fails', async () => {
    const failureUser = await user();
    // Test-only extra constraint forces a real database failure during bulk progress insertion.
    await client.unsafe(
      `ALTER TABLE app.learner_node_progress ADD CONSTRAINT test_002b_force_rollback CHECK (user_id <> '${failureUser}'::uuid OR node_key <> 'even-or-odd')`,
    );
    try {
      await expect(enrollLearner(db, cohortId, failureUser)).rejects.toThrow();
      expect(
        await client`SELECT * FROM app.cohort_memberships WHERE cohort_id=${cohortId} AND user_id=${failureUser}`,
      ).toHaveLength(0);
      expect(
        await client`SELECT * FROM app.learner_node_progress WHERE cohort_id=${cohortId} AND user_id=${failureUser}`,
      ).toHaveLength(0);
    } finally {
      await client.unsafe(
        'ALTER TABLE app.learner_node_progress DROP CONSTRAINT test_002b_force_rollback',
      );
    }
  });
  it('does not reactivate an inactive membership or repair incomplete existing progress', async () => {
    const inactive = await user();
    await enrollLearner(db, cohortId, inactive);
    await client`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${cohortId} AND user_id=${inactive}`;
    await expect(enrollLearner(db, cohortId, inactive)).rejects.toThrow(/Inactive membership/);
    const partial = await user();
    await client`INSERT INTO app.cohort_memberships(cohort_id,user_id) VALUES (${cohortId},${partial})`;
    await expect(enrollLearner(db, cohortId, partial)).rejects.toThrow(/incomplete progress/);
  });
  it('rejects inactive users and non-learner roles', async () => {
    for (const id of [await user('learner', false), await user('operator'), await user('admin')])
      await expect(enrollLearner(db, cohortId, id)).rejects.toThrow(/active domain learner/);
  });
  it('pins versions and forbids switching an enrolled cohort, including inactive memberships', async () => {
    const other = testCurriculum();
    const version = await importCurriculum(
      db,
      other.curriculum,
      other.gitCommitSha,
      other.evaluations,
    );
    await expect(pinCohort(db, cohortId, version.id)).rejects.toThrow(/enrolled cohort/);
    await expect(
      client`UPDATE app.cohorts SET curriculum_version_id=${version.id} WHERE id=${cohortId}`,
    ).rejects.toMatchObject({ code: 'P0001' });
    const empty = await createCohort(db, cohortInput(versionId));
    await pinCohort(db, empty.id, version.id);
    const member = await user();
    await enrollLearner(db, empty.id, member);
    await client`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${empty.id} AND user_id=${member}`;
    await expect(pinCohort(db, empty.id, versionId)).rejects.toThrow(/enrolled cohort/);
  });
  it('serializes enrollment against concurrent version pinning', async () => {
    const other = testCurriculum();
    const version = await importCurriculum(
      db,
      other.curriculum,
      other.gitCommitSha,
      other.evaluations,
    );
    const target = await createCohort(db, cohortInput(versionId));
    const member = await user();
    await Promise.allSettled([
      pinCohort(db, target.id, version.id),
      enrollLearner(db, target.id, member),
    ]);
    const rows =
      await client`SELECT p.curriculum_version_id,c.curriculum_version_id AS pinned FROM app.learner_node_progress p JOIN app.cohorts c ON c.id=p.cohort_id WHERE p.cohort_id=${target.id}`;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.curriculum_version_id === row.pinned)).toBe(true);
  });
  it('grants web reads without curriculum/progress writes or evaluation-spec access', async () => {
    await client.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE nextera_web');
      expect(await tx`SELECT title FROM app.curriculum_nodes LIMIT 1`).toHaveLength(1);
    });
    for (const statement of [
      'UPDATE app.cohorts SET name=name',
      'DELETE FROM app.cohort_memberships',
      "UPDATE app.learner_node_progress SET state='mastered'",
      'SELECT resolved_evaluation_spec FROM app.curriculum_nodes',
      'SELECT * FROM judge.jobs',
    ])
      await expect(
        client.begin(async (tx) => {
          await tx.unsafe('SET LOCAL ROLE nextera_web');
          await tx.unsafe(statement);
        }),
      ).rejects.toMatchObject({ code: '42501' });
  });
});
