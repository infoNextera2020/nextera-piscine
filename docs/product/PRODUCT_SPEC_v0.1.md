# NextEra Piscine Pilot v0.1 — Product Specification

Status: Frozen for Vertical Slice 001

## Product objective
Validate the core NextEra learning loop in a real Piscine starting 20 Nov 2026:

**Learn → Solve → Submit → Automated Assessment → Feedback → Mastery → Unlock**

This is not the full NextEra Portal. It is the smallest production-minded system that can prove whether the learning and assessment model works with real learners.

## Solo-builder constraint
The product is being built by one developer with AI coding assistants. Scope decisions must optimize for operational value and reliability, not breadth.

## P0 — must exist before launch
1. Authentication and learner identity
2. Piscine / quest / exercise structure
3. Exercise subject pages
4. Submission records
5. Isolated automated judge
6. Visible + hidden tests
7. Timeout / resource limits
8. Attempts history
9. Unlock rules
10. Checkpoints
11. Learner progress dashboard
12. Admin cohort dashboard
13. Basic analytics/events
14. Audit/log visibility for judge failures

## Explicitly out of MVP
- AI tutor
- payments
- certificates
- native mobile app
- advanced community features
- full peer-review system
- placement engine
- complex microservices

## Primary learner screens
- Control Room / dashboard
- Quest Map
- Exercise / Challenge
- Submission feedback
- Checkpoint

## Primary operator screens
- Cohort Pulse
- blocked/stuck learner queue
- failure heatmap by exercise
- learner attempt history
- judge health

## Core learning rules
- Progress is evidence-based, not content-completion based.
- Hidden tests must never expose implementation details.
- A task may require correctness + performance + integrity conditions.
- Checkpoints must test transfer, not memorization of previous tasks.
- Failed infrastructure executions must be distinguishable from failed learner code.

## Pilot success metrics
### Reliability
- Submission execution success rate ≥ 99%
- Median judge result under 4 seconds for normal exercises
- Clear separation of runner failure vs learner failure

### Assessment quality
- Critical false-pass rate target: 0%
- Track false negatives through manual review samples
- Record hidden-test weakness found during pilot

### Learning
- Exercise completion rate
- Attempts per exercise
- Time-to-first-pass
- Checkpoint pass rate
- Transfer gap: exercise performance vs checkpoint performance
- Drop-off point

### Operations
- Students blocked > 90 minutes
- Support requests per learner
- Manual interventions per 100 submissions
- Top failing exercises

## Pre-launch validation
Run synthetic/fake learner tests before the real Piscine:
- correct solutions
- syntax errors
- infinite loops
- memory-heavy code
- huge output
- O(n²) solutions
- hard-coded outputs
- malformed submissions
- attempts to access network/filesystem beyond allowed scope

## Architecture principle
Start with a modular monolith for product logic and a separately isolated judge/worker execution boundary. Do not start with microservices unless actual scale requires them.

## UI direction
The interface should feel like an engineering control system rather than a generic LMS:
- dark graphite base
- NextEra teal → lime gradient
- strong information hierarchy
- monospace micro-labels for system state
- minimal decorative effects
- distinctive quest topology and operational dashboards
- no generic AI gradients, glass cards, or random floating blobs
