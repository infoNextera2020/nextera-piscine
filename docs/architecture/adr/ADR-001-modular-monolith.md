# ADR-001 — Modular Monolith for Product Logic

## Status

Accepted

## Context

The NextEra Piscine pilot must be production-minded but is being built by one developer before the 20 November 2026 launch.

The system needs authentication, learning content, progression, submissions, checkpoints, analytics, administration, and automated assessment.

Splitting these concerns into independent network services would increase development time, deployment complexity, debugging cost, and operational risk before we have evidence that independent scaling is required.

## Decision

The product application will begin as a modular monolith.

The web/product system owns:

- learner identity integration
- cohorts
- Piscine versions
- progression
- unlock rules
- submissions
- checkpoint state
- mastery
- analytics events
- admin operations

Modules must retain explicit boundaries inside the codebase even though they run in one application.

The Judge Runner is excluded from the monolith because it executes untrusted learner code and requires a separate security boundary.

## Consequences

Positive:

- faster development
- fewer deployments
- simpler transactions
- easier local development
- easier debugging
- lower operational cost

Negative:

- modules share one deployment
- careless code can create coupling

If scale later proves that a module requires independent scaling, it may be extracted behind an explicit interface.

Microservices will not be introduced without measured operational need.