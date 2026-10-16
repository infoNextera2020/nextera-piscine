# Authentication integration boundary

Foundation 001 has no login flow, identity provider implementation, or fake user.
The public foundation page and liveness endpoint do not require authentication.

Later, a server-only Supabase Auth adapter will verify the request identity and
resolve its subject through `app.users.auth_user_id`. Domain user IDs are separate
from Supabase subjects. Domain roles and cohort membership authorize product
operations; browser metadata and client-side checks cannot supply authority.

Do not add a fallback user, trust an unverified session, or expose protected
product routes before that boundary is implemented.
