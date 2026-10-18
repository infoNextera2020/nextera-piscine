import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';
import { readAccessibleSubject } from '@nextera/db/cohorts';
import type { SubmissionRules } from '@nextera/domain';
import { getDatabase } from '../../../../../../lib/auth/server';
import { authorizeCohortPage } from '../../../../../../lib/cohorts/server';
import { SubmissionForm } from '../../../../../../lib/submissions/form';
import { submissionContext } from '@nextera/db/submissions';

export default async function SubjectPage({
  params,
}: {
  params: Promise<{ cohortId: string; nodeKey: string }>;
}) {
  const { cohortId, nodeKey } = await params;
  const { user, cohort } = await authorizeCohortPage(cohortId);
  const subject = await readAccessibleSubject(getDatabase(), user, cohort.id, nodeKey);
  if (!subject) notFound();
  const rules = subject.submissionRules as unknown as SubmissionRules;
  let submittable = false;
  if (user.role === 'learner') {
    try {
      await submissionContext(getDatabase(), user.authUserId, cohort.id, nodeKey);
      submittable = true;
    } catch {
      // Unapproved/non-runnable fixtures remain readable but cannot accept work.
    }
  }
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-16">
      <Link className="text-teal-300" href={`/app/cohorts/${cohort.id}`}>
        {cohort.name}
      </Link>
      <h1 className="text-3xl font-semibold">{subject.title}</h1>
      {user.role !== 'learner' && (
        <p>
          {user.role === 'admin' ? 'Administrative' : 'Assigned operator'} read-only subject
          preview.
        </p>
      )}
      <article className="space-y-4 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-900 [&_pre]:p-4 [&_h1]:text-2xl [&_ul]:list-inside [&_ul]:list-disc">
        <Markdown skipHtml>{subject.subjectMarkdown}</Markdown>
      </article>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Submission requirements</h2>
        <p>Required files: {rules.required_files.join(', ')}</p>
        <p>Allowed extensions: {rules.allowed_extensions.join(', ')}</p>
        <p>Maximum size: {rules.max_size_kb} KiB</p>
        <p>Write your solution locally.</p>
      </section>
      {submittable && (
        <SubmissionForm cohort={cohort.id} node={nodeKey} filename={rules.required_files[0]!} />
      )}
    </main>
  );
}
