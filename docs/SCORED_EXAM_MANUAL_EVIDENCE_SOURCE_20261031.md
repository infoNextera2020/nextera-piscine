# Scored Exam1 mentor review source milestone

The existing operator detail/form now mounts an exact scored-exam attempt at
`/operator?attempt=<uuid>`, optionally selecting an immutable submission with
`&submission=<uuid>`. The default operator overview and queue remain unchanged.

The detail supports question and snapshot selection, immutable answer/history
display, provisional functional evidence, the approved manual mark categories,
and explicit saved, stale and uncertain states. A pending mentor review does not
block the learner from finishing the exam. A saved note is reported only when a
durable native evidence document exists; a historical digest alone is not a saved
note.

## Durable evidence and authority

Draft0035 adds private immutable policy/evidence records and an atomic wrapper
around the unchanged scoring-event writer. Evidence insertion failure raises in
the same transaction, rolling back the scoring write. Actor, assignment, attempt,
question, immutable submission, rubric, revision and operation identity remain
server-owned. Exact retry reuses the original operation and evidence; it does not
silently overwrite a later revision.

New V2 writes require configured positive native evidence/criteria byte caps and
the exact approved criteria document. The service verifies the whole UTF-8 text
against the published manual-criteria digest; the native wrapper verifies that
binding again. There is no synthesized rubric-text fallback. Existing exact
retained retries still require fresh authority and the original native evidence.

Primary and secondary reviewer assignments, attempt closure, private reads and
current native context are checked by the existing contracts. The new draft does
not change drafts0024, 0028, 0032 or 0033. The external user foreign key is created
after returning to the already held bootstrap owner context; no additional
REFERENCES grant is introduced. Lock order follows the existing writer operation
lock, target-head update lock, then context read.

Authorized staff can see the actual learner display name. A student number is not
yet available in the source projection, and the UI reports that explicitly rather
than inventing one. The approved settings-only learner visibility requirement
remains a separate identity implementation step.

## Verification and limits

The implementation and independent reviewer each passed 182 focused fake,
component, API/service and proposal tests. DB, web and operator typechecks, scoped
lint and formatting passed. Independent review resolved ownership/foreign-key
ordering, lock ordering and accessor-safe mark capture findings.

The root test scripts now run operator component tests with their existing React
and JSX configuration, and include their dedicated typecheck. Initial aggregate
attempts that lacked that configuration remain retained as failed evidence.

No native SQL was applied for this milestone. Effective ACLs, PostgreSQL
concurrency, real rollback and live browser rendering remain unverified. An
earlier file-URL browser action was blocked and was not retried through another
route. Live use also requires the reviewed native schema and authentic published
criteria/cap configuration; source or fake tests do not establish those runtime
preconditions.
