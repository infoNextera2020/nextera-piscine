# ADR-003 — Separate Isolated Judge Runner

## Status

Accepted

## Context

Learner submissions contain untrusted code.

That code may intentionally or accidentally:

- loop forever
- consume excessive memory
- spawn processes
- generate excessive output
- access the network
- access the filesystem
- attempt privilege escalation
- crash

Running learner code inside the product server would create unacceptable security risk.

## Decision

Automated code evaluation will run on dedicated Judge Runner infrastructure separated from the web application and production secrets.

Every evaluation runs inside a disposable isolated container.

Minimum execution controls:

- no network access unless explicitly required
- non-root user
- memory limit
- CPU limit
- process/PID limit
- wall-clock timeout
- output limit
- restricted filesystem
- dropped Linux capabilities
- no production credentials
- no Docker socket exposed to learner code

Judge infrastructure must be independently observable.

## Consequences

The runner becomes a separate deployable component.

This increases infrastructure work but establishes the minimum acceptable security boundary for untrusted code execution.