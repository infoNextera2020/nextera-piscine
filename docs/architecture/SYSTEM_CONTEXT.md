# NextEra Piscine — System Context

## Product

NextEra Piscine is a self-paced, project-based technical learning and assessment system.

The first production pilot begins on 20 November 2026.

The system exists to validate this learning loop:

Learn
→ Solve
→ Submit
→ Automated Assessment
→ Feedback
→ Mastery
→ Unlock

## Users

### Learner

Reads challenges, submits work, receives assessment results, completes checkpoints, and progresses through the Piscine.

### Operator

Monitors cohort progress, learner friction, submissions, Judge health, and operational problems.

### Administrator

Controls cohort configuration and privileged platform operations.

## Primary System Boundaries

### Product Application

Responsibilities:

- authentication integration
- cohort membership
- curriculum delivery
- progression
- submissions
- mastery
- checkpoints
- analytics
- administration

### PostgreSQL

Source of truth for:

- users
- cohorts
- curriculum versions
- learner state
- submissions
- Judge jobs
- results
- analytics events

### Object Storage

Stores submission artifacts and larger project files.

### Judge Runner

Trusted worker responsible for evaluating untrusted learner submissions.

The Runner:

- claims Judge Jobs
- obtains learner artifacts
- loads trusted test packs
- creates isolated execution environments
- enforces limits
- executes tests
- records structured results

### Sandbox

Disposable execution environment containing untrusted learner code.

It has no access to product secrets.

## External Services

### Supabase

- authentication
- PostgreSQL hosting initially
- object storage initially

### Vercel

Potential hosting for the web application.

### GitHub

- source control
- CI/CD
- trusted Judge images/test packs

## Core Architectural Rule

Untrusted learner code must never execute inside the product application environment.