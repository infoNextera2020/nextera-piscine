# ADR-007 — Explicit Submission State Machine

## Status

Accepted

## Context

A learner submission travels through multiple asynchronous stages.

A learner's incorrect code must never be confused with infrastructure failure.

State transitions also need to remain auditable.

## Decision

Submissions use explicit states.

Initial states:

- queued
- running
- passed
- failed
- compile_error
- runtime_error
- timeout
- system_error
- cancelled

System failures do not count as learner failures.

Examples:

Learner failures:

- wrong output
- compilation error
- runtime error caused by learner code
- timeout caused by learner algorithm

Infrastructure failures:

- container creation failure
- runner internal error
- submission artifact download failure
- unavailable Judge infrastructure

Infrastructure failures may be retried automatically.

Maximum automatic infrastructure retries:

2

A system_error must remain visible to operators.

Passing a submission triggers progression recalculation.

## State Flow

submitted
    |
    v
queued
    |
    v
running
    |
    +----> passed
    |
    +----> failed
    |
    +----> compile_error
    |
    +----> runtime_error
    |
    +----> timeout
    |
    +----> system_error

## Consequences

Submission state is intentionally explicit rather than inferred from Judge output.

This improves analytics, learner feedback, retries, debugging, and operational reliability.