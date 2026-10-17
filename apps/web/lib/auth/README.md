# Authentication integration boundary

Foundation 002A verifies Supabase identities with the Auth server (`getUser`),
then resolves `app.users.auth_user_id` using a restricted server-only connection.
Roles and active status come exclusively from that domain record. No login path
inserts users, enrolls learners, or trusts user metadata.

`requireAuthenticatedUser`, `requireDomainUser`, and `requireRole` throw the pure
domain `AccessDenied` error. `authorizePage` maps those errors to the public login
or explicit denial page. Future handlers/actions must call the guards themselves;
Proxy refresh and UI visibility do not constitute authorization.

React request memoization avoids repeated lookups within one render. There is no
cross-request authorization cache; role changes/deactivation apply on the next
request. Foundation 002B adds `requireCohortAccess`. Learners and operators need
an active membership in an active cohort. Active admins have explicit read-only
access to published cohort curricula. Cohort queries repeat these predicates;
unauthorized cohort/subject page requests return 404 without revealing content.
Learner subjects require available/in_progress/mastered progress. Assigned
operators/admins may preview subjects without claiming learner progress.

Supabase SSR clients are request scoped. Next.js Proxy refreshes cookies on both
request and response and forwards the SDK cache headers. Session-aware responses
are private/no-store. The server never authorizes from an unverified getSession
user object. Only the publishable key enters the browser adapter.

Password login/logout are Server Actions with Next.js origin checking. No signup,
OAuth callback, password recovery, or public provisioning endpoint is introduced.
