# ADR-006 — Supabase Authentication for the Pilot

## Status

Accepted

## Context

The Piscine requires secure learner identity, login, session management, password recovery, and administrative user handling.

Authentication is necessary infrastructure but is not a differentiating capability of the NextEra learning model.

Implementing authentication internally would create security risk and consume time needed for the learning and Judge systems.

## Decision

Supabase Auth will provide authentication for the initial pilot.

The application will maintain its own domain-level user record referencing the Supabase identity.

Application authorization remains owned by NextEra.

Initial roles:

- learner
- operator
- admin

The application must never rely exclusively on client-side role checks.

## Consequences

Supabase becomes an external dependency for authentication.

Its use does not determine the structure of the core domain and may be replaced later if needed.