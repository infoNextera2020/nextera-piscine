# Manual portal demo

Automated browser tests create cohorts in isolated test databases, then disable
their accounts. They do not populate the normal local database. An empty
`pnpm cohort:list` in the normal environment is therefore expected.

Start local Supabase first. Prepare a persistent isolated demo once, using your
existing Supabase Auth user UUID (not the domain user UUID):

```sh
pnpm local:demo:prepare --auth-user-id YOUR_AUTH_UUID
pnpm local:demo
```

Open <http://127.0.0.1:3103> and sign in with your existing email/password.
The account has a fresh learner profile enrolled in **Local demo · sample curriculum**.
Open Command Center, Roadmap, the first available Challenge, and Evidence.
Your normal database and learner profile are unchanged.

To return later, run `pnpm local:demo` again. Do not run preparation again.
Use this command instead of the ordinary dev command when exploring sample data.
Stop the server with Ctrl+C. Avoid running both dev commands simultaneously;
they share the application's Next.js development output directory.

For checkpoint and result examples, `.tools/local-demo.json` contains local-only
sample credentials: `learner` is the sample challenge-history account;
`assessments.pass`, `.fail`, `.infra`, `.active`, and `.ready` contain sample
account email addresses. All sample accounts use the top-level `password`.
Sign out before changing accounts. Never share or commit this file: it also
contains database credentials. The directory is Git-ignored and the file has
owner-only permissions on Linux.

- PASS, LEARNER FAIL, and INFRASTRUCTURE BLOCKED are seeded through the existing
  database assessment operations, not computed in the browser.
- The ready account can start a checkpoint. Active attempts expire according to
  trusted server time; they are not reset when the demo restarts.
- Fixture metadata does not include a configured live Runner/executable pack.
  New uploads can remain queued. This demo supports portal browsing and intake
  exploration, not end-to-end code execution certification.
- The normal curriculum stays unpublished and the Runner catalog stays CANDIDATE.
  No production migrations, checkpoint policies, or Judge behavior are changed.
- `pnpm cohort:list` still lists the normal database, not this isolated demo.

Use the repository's pinned Node version (24.19.0) for these commands.
