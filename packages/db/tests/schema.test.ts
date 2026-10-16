import { describe, expect, it } from 'vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import {
  activityEvents,
  cohortMemberships,
  cohorts,
  curriculumNodes,
  curriculumVersions,
  judgeAttempts,
  judgeJobs,
  judgeResults,
  judgeWorkers,
  learnerNodeProgress,
  nodePrerequisites,
  quests,
  stateEvents,
  submissionArtifacts,
  submissions,
  users,
  progressState,
  submissionState,
} from '../schema/index';
import { PROGRESS_STATES, SUBMISSION_STATES } from '@nextera/domain';

const tables = [
  activityEvents,
  cohortMemberships,
  cohorts,
  curriculumNodes,
  curriculumVersions,
  judgeAttempts,
  judgeJobs,
  judgeResults,
  judgeWorkers,
  learnerNodeProgress,
  nodePrerequisites,
  quests,
  stateEvents,
  submissionArtifacts,
  submissions,
  users,
];

describe('database schema contract', () => {
  it('loads exactly the sixteen application tables without owning Supabase Auth', () => {
    expect(
      tables
        .map((table) => {
          const { schema, name } = getTableConfig(table);
          return `${schema}.${name}`;
        })
        .sort(),
    ).toEqual([
      'app.activity_events',
      'app.cohort_memberships',
      'app.cohorts',
      'app.curriculum_nodes',
      'app.curriculum_versions',
      'app.learner_node_progress',
      'app.node_prerequisites',
      'app.quests',
      'app.state_events',
      'app.submission_artifacts',
      'app.submissions',
      'app.users',
      'judge.attempts',
      'judge.jobs',
      'judge.results',
      'judge.workers',
    ]);
    expect(progressState.enumValues).toEqual(PROGRESS_STATES);
    expect(submissionState.enumValues).toEqual(SUBMISSION_STATES);
  });

  it('represents progress checks and same-context first-passing evidence', () => {
    const config = getTableConfig(learnerNodeProgress);
    expect(config.checks.map((value) => value.name)).toContain('progress_state_timestamps_check');
    expect(config.checks.map((value) => value.name)).toContain('progress_timestamp_order_check');
    const evidence = config.foreignKeys.find(
      (value) => value.getName() === 'progress_first_passing_submission_fk',
    );
    expect(evidence?.reference().columns.map((column) => column.name)).toEqual([
      'first_passing_submission_id',
      'cohort_id',
      'user_id',
      'curriculum_version_id',
      'node_key',
    ]);
  });

  it('emits literal CHECK SQL rather than unusable bind placeholders in DDL', () => {
    const dialect = new PgDialect();
    for (const table of tables) {
      for (const constraint of getTableConfig(table).checks) {
        expect(dialect.sqlToQuery(constraint.value).params, constraint.name).toEqual([]);
      }
    }
  });
});
