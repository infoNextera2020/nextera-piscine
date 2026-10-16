# ADR-002 — PostgreSQL as the Initial Judge Job Queue

## Status

Accepted

## Context

Every learner submission requiring automated evaluation creates a Judge Job.

The MVP requires reliable job claiming, retries for infrastructure failures, state tracking, and auditability.

Adding Redis, RabbitMQ, Kafka, or another queueing system would introduce another infrastructure dependency during the pilot.

The expected Piscine workload does not justify that complexity.

## Decision

PostgreSQL will serve as the initial Judge Job queue.

Workers claim jobs using row locking equivalent to:

SELECT ...
FOR UPDATE SKIP LOCKED

A job may only be claimed by one worker.

Primary job states:

- queued
- claimed
- running
- completed
- system_error

Worker and job transitions must be persisted.

## Consequences

Positive:

- fewer infrastructure dependencies
- transactional creation of Submission + Judge Job
- simple operational inspection
- straightforward recovery

Negative:

- PostgreSQL is not intended to become a high-throughput distributed queue forever

A dedicated queue will only be introduced after real workload measurements demonstrate the need.