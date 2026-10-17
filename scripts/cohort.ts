import { parseArgs } from 'node:util';
import { createCohort, enrollLearner, pinCohort } from '@nextera/db/operations/cohorts';
import { cohorts } from '@nextera/db/schema';
import { withOperations } from './operations';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    'starts-at': { type: 'string' },
    'version-id': { type: 'string' },
    'cohort-id': { type: 'string' },
    'user-id': { type: 'string' },
  },
});
const required = (key: keyof typeof values) => {
  const value = values[key];
  if (!value) throw new Error(`--${key} is required.`);
  return value;
};
const uuid = (key: keyof typeof values) => {
  const value = required(key);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))
    throw new Error(`--${key} must be a UUID.`);
  return value;
};
if (positionals.length !== 1) throw new Error('One cohort operation is required.');
await withOperations(async (db) => {
  switch (positionals[0]) {
    case 'create': {
      const start = required('starts-at');
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(start))
        throw new Error('--starts-at must include time and explicit timezone.');
      const cohort = await createCohort(db, {
        slug: required('slug'),
        name: required('name'),
        curriculumVersionId: uuid('version-id'),
        startsAt: new Date(start),
      });
      console.info(`Cohort ${cohort.id}: ${cohort.slug}, pinned to ${cohort.curriculumVersionId}.`);
      break;
    }
    case 'pin': {
      const cohort = await pinCohort(db, uuid('cohort-id'), uuid('version-id'));
      console.info(`Cohort ${cohort.id} pinned to ${cohort.curriculumVersionId}.`);
      break;
    }
    case 'enroll': {
      const member = await enrollLearner(db, uuid('cohort-id'), uuid('user-id'));
      console.info(
        `Enrollment active for domain learner ${member.userId} in cohort ${member.cohortId}.`,
      );
      break;
    }
    case 'list':
      console.table(
        await db
          .select({
            id: cohorts.id,
            slug: cohorts.slug,
            name: cohorts.name,
            curriculumVersionId: cohorts.curriculumVersionId,
            status: cohorts.status,
            startsAt: cohorts.startsAt,
          })
          .from(cohorts),
      );
      break;
    default:
      throw new Error('Use cohort:create, cohort:pin, cohort:enroll, or cohort:list.');
  }
});
