import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  aggregateCheckpoint,
  checkpointScoringPolicy,
  CHECKPOINT_POLICY,
} from '../../domain/checkpoints';

const draft = readFileSync(
  new URL('../migration-drafts/0017_checkpoint_policy_v2.DRAFT.sql', import.meta.url),
  'utf8',
);
const old = readFileSync(
  new URL('../migrations/0007_checkpoint_operations.sql', import.meta.url),
  'utf8',
);
const read = (name: string) =>
  readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8');
const body = (source: string, name: string) => {
  const value = source.match(
    new RegExp('CREATE (?:OR REPLACE )?FUNCTION app\\.' + name + '\\([\\s\\S]*?END \\$\\$;'),
  )?.[0];
  if (!value) throw new Error('Missing source function: ' + name);
  return value.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
};

describe('Checkpoint policy-v2 migration draft (source checks, no SQL execution)', () => {
  it('keeps historical migrations byte-identical and the draft outside the journal', () => {
    const hashes: Record<string, string> = {
      '0006_checkpoint_domain.sql':
        'd6b8b6a4b553eb53e1a238ebc312a523c02a48fe9ae95da67589233cd8afe67a',
      '0007_checkpoint_operations.sql':
        '99e9d01c77f6eeb9f6f968e903375083531a3d2f112dfaca3249d458aaeeb35c',
      '0008_raid_domain.sql': 'c4ac095e2b8cbdde3df918975801cc7ee0cc25c13990bc193369f097b6a4a718',
      '0009_raid_operations.sql':
        '49f98790ac105e99d2f946823813ee7aa150b0b9247f777afb494707ae5d4cbe',
      '0010_raid_artifact_read.sql':
        '164883c77851b063ea0ae643b7ec87fcfd54c9365f60cc6dade1bbf5616dcfe0',
    };
    for (const [name, digest] of Object.entries(hashes))
      expect(createHash('sha256').update(read(name)).digest('hex')).toBe(digest);
    expect(read('meta/_journal.json')).not.toContain('0017');
    expect(draft).toContain('REVIEW DRAFT ONLY');
    expect(draft).toContain('not PostgreSQL parsing, concurrency, grants or live-result evidence');
    // Ignore function bodies: the migration must not manufacture data while installing source.
    const ddl = draft.replace(/\$\$[\s\S]*?\$\$/g, 'BODY');
    expect(ddl).not.toMatch(
      /\b(?:INSERT INTO|UPDATE app\.|DELETE FROM|CREATE ROLE|CREATE USER|ALTER ROLE|CREATE DATABASE)\b/,
    );
    expect(draft.trim()).toMatch(/COMMIT;$/);
  });
  it('requires an explicit v2 threshold and derives count from frozen tasks, with no global fallback', () => {
    const policy = body(draft, 'checkpoint_policy_v2');
    expect(policy).toContain("task_count:=jsonb_array_length(definition->'tasks')");
    expect(policy).toContain("jsonb_typeof(definition->'passPoints') IS DISTINCT FROM 'number'");
    expect(policy).toContain("(definition->>'passPoints')::numeric NOT BETWEEN 1 AND task_count");
    expect(policy).toContain("required_points:=(definition->>'passPoints')::integer");
    expect(policy).not.toMatch(/coalesce[^;]*(?:passPoints|required_points)/i);
    expect(policy).toContain(
      "RETURN jsonb_build_object('policy_version',1,'task_count',4,'pass_points',3)",
    );
    expect(draft).toContain('CASE makes type/number checks precede casts');
  });
  it('changes the definition projection cardinality without weakening committed identity or uniqueness', () => {
    const guard = body(draft, 'guard_checkpoint_definition');
    expect(guard).toContain("v.status IS DISTINCT FROM 'draft'");
    expect(guard).toContain("n.kind IS DISTINCT FROM 'checkpoint'");
    expect(guard).toContain('n.evaluation_spec_digest IS DISTINCT FROM NEW.definition_digest');
    expect(guard).toContain(
      "n.resolved_evaluation_spec->'checkpoint_definition' IS DISTINCT FROM NEW.definition",
    );
    expect(guard).toContain("count(DISTINCT value->>'key')");
    expect(guard).toContain("count(DISTINCT value->>'testPackId')");
    expect(guard.match(/<>task_count/g)).toHaveLength(2);
    expect(guard).not.toMatch(/<>4/);
  });
  it('retains exact start snapshot shape, access locks, retries and budgets except explicit policy validation', () => {
    const next = body(draft, 'start_checkpoint').replace(
      '\n  PERFORM app.checkpoint_policy_v2(d.definition);',
      '',
    );
    expect(next).toBe(body(old, 'start_checkpoint'));
    expect(draft).not.toMatch(
      /CREATE OR REPLACE FUNCTION app\.(?:finish_checkpoint|accept_checkpoint_submission|checkpoint_user|checkpoint_lock_access|grant_checkpoint_replacement|announce_checkpoint_retake|guard_checkpoint_history)\(/,
    );
    expect(draft).not.toContain('DROP TRIGGER checkpoint_attempt_history');
  });
  it('binds policy to immutable attempt identity/digest rather than a mutable definition', () => {
    const attempt = body(draft, 'checkpoint_attempt_policy_v2');
    for (const key of [
      'attempt_id',
      'cohort_id',
      'learner_id',
      'curriculum_version_id',
      'node_key',
      'definition_digest',
      'normal_slot',
      'kind',
      'started_at',
      'deadline_at',
    ])
      expect(attempt).toContain("a.snapshot->>'" + key + "'");
    expect(attempt).toContain("app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')");
    expect(attempt).toContain("RETURN app.checkpoint_policy_v2(a.snapshot->'definition')");
    expect(attempt).not.toContain('app.checkpoint_definitions');
    const context = body(draft, 'checkpoint_task_context').replace(
      'PERFORM app.checkpoint_attempt_policy_v2(a);\n  ',
      '',
    );
    expect(context).toBe(body(old, 'checkpoint_task_context'));
  });
  it('keeps trusted terminal-result joins, idempotency and progression; only scoring/evidence become versioned', () => {
    const final = body(draft, 'finalize_checkpoint');
    expect(final).toContain('IF FOUND THEN RETURN oid; END IF;');
    expect(final.indexOf('IF FOUND THEN RETURN oid; END IF;')).toBeLessThan(
      final.indexOf('scoring:=app.checkpoint_attempt_policy_v2(a)'),
    );
    expect(final).toContain(
      "CASE WHEN passed_count>=required_points THEN 'passed' WHEN passed_count+infra_count>=required_points THEN 'infrastructure_blocked' ELSE 'failed' END",
    );
    for (const line of body(old, 'finalize_checkpoint')
      .split('\n')
      .filter((line) =>
        /r\.application_status|j\.terminal_result_id|r\.evaluation_digest|UPDATE app\.learner_node_progress|pg_advisory_xact_lock|FOR UPDATE|checkpoint_task_key|<3/.test(
          line,
        ),
      ))
      expect(final).toContain(line);
    expect(final).toContain(
      "proof:=jsonb_build_object('snapshot_digest',a.snapshot_digest,'policy_version',1,'points',passed_count,'status',outcome_status,'results',history)",
    );
    expect(final).toContain(
      "'policy_version',2,'task_count',(scoring->>'task_count')::integer,'pass_points',required_points",
    );
    expect(final).not.toMatch(/passed_count>=3|passed_count\+infra_count>=3/);
    expect(final).toContain(
      "WHERE s.checkpoint_attempt_id=attempt AND s.checkpoint_task_key=task->>'key'",
    );
  });
  it('binds new outcome metadata to frozen policy without rewriting existing evidence', () => {
    const guard = body(draft, 'guard_checkpoint_outcome_policy_v2');
    expect(guard).toContain('scoring:=app.checkpoint_attempt_policy_v2(a)');
    expect(guard).toContain("NEW.evidence->'task_count' IS DISTINCT FROM scoring->'task_count'");
    expect(guard).toContain("NEW.evidence->'pass_points' IS DISTINCT FROM scoring->'pass_points'");
    expect(guard).toContain("app.checkpoint_digest(NEW.evidence,'nextera-checkpoint-outcome')");
    expect(draft).toContain('BEFORE INSERT ON app.checkpoint_outcomes');
    expect(draft).not.toMatch(
      /UPDATE app\.checkpoint_outcomes|DELETE FROM app\.checkpoint_(?:attempts|outcomes|definitions)/,
    );
    expect(draft).toContain('VALIDATE CONSTRAINT checkpoint_outcome_score');
  });
  it('makes per-attempt policy readable and gates v2 publication on the installed contract', () => {
    const view = body(draft, 'read_checkpoint');
    expect(view).toContain('app.checkpoint_attempt_policy_v2(ca) AS policy');
    expect(view).toContain("RETURN jsonb_build_object('policy',scoring");
    expect(view).toContain('CASE WHEN a.id IS NOT NULL THEN app.checkpoint_attempt_policy_v2(a)');
    const publication = body(draft, 'guard_checkpoint_publication');
    expect(publication).toContain('Publication requires every committed checkpoint definition');
    expect(publication).toContain("d.definition->>'policyVersion'='2'");
    expect(publication).toContain('CHECKPOINT_POLICY_V2_NOT_READY');
    expect(draft).toContain("'runtime_verified',false");
  });
  it('requires existing isolated ownership, revokes new public execution and never creates access', () => {
    expect(draft).toContain('NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls');
    expect(draft).toContain("pg_has_role(current_user,'nextera_checkpoint_owner','SET')");
    expect(draft).toContain(
      "RAISE EXCEPTION 'Checkpoint v2 objects already exist; review migration state'",
    );
    expect(draft).toContain(
      'app.guard_checkpoint_outcome_policy_v2(),app.checkpoint_policy_contract_v2() FROM PUBLIC',
    );
    expect(draft).toContain('TO nextera_web,nextera_result_application');
    expect(draft).not.toMatch(
      /CREATE ROLE|CREATE USER|GRANT nextera_checkpoint_owner TO|GRANT ALL|TO PUBLIC/,
    );
    expect(draft).toContain('Current TS CheckpointView/UI omit policy metadata');
  });
});

describe('Existing domain truth used by the SQL successor, synthetic definitions only', () => {
  it.each([1, 3, 4, 10])('requires per-exam scoring for %i frozen tasks', (count) => {
    const tasks = Array.from({ length: count }, () => ({
      passed: true,
      pending: false,
      infrastructure: false,
    }));
    const definition = {
      policyVersion: 2 as const,
      durationSeconds: 5400 as const,
      tasks,
      passPoints: count,
    };
    expect(checkpointScoringPolicy(definition)).toEqual({
      version: 2,
      taskCount: count,
      passPoints: count,
    });
    expect(aggregateCheckpoint(tasks, definition)).toEqual({ status: 'passed', points: count });
    for (const passPoints of [undefined, 0, count + 1, 1.5])
      expect(() => checkpointScoringPolicy({ ...definition, passPoints } as never)).toThrow(
        'CHECKPOINT_POLICY',
      );
  });
  it('preserves legacy four/pass-three and infrastructure uncertainty without selecting v2 values', () => {
    expect(CHECKPOINT_POLICY).toMatchObject({
      version: 1,
      taskCount: 4,
      passPoints: 3,
      taskQuota: 3,
      normalAttempts: 2,
      durationSeconds: 5400,
      cooldownSeconds: 86400,
    });
    const tasks = [true, true, false, false].map((passed) => ({
      passed,
      pending: false,
      infrastructure: false,
    }));
    expect(aggregateCheckpoint(tasks)).toEqual({ status: 'failed', points: 2 });
    tasks[2]!.infrastructure = true;
    expect(aggregateCheckpoint(tasks)).toEqual({ status: 'infrastructure_blocked', points: 2 });
    tasks[2]!.passed = true;
    expect(aggregateCheckpoint(tasks)).toEqual({ status: 'passed', points: 3 });
  });
});
