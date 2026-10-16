# ADR-004 — Curriculum Stored as Versioned Files in Git

## Status

Accepted

## Context

The Piscine curriculum contains quests, challenges, projects, checkpoints, descriptions, metadata, skill mappings, and Judge configuration.

Building a CMS before the first pilot would consume substantial development time.

Curriculum changes must also be reviewable and versioned.

## Decision

Piscine curriculum will be stored in the repository under:

content/piscine-v1/

Content will use files such as:

- YAML for metadata
- Markdown for challenge/project subjects
- versioned Judge test-pack references

The application database stores the curriculum version a cohort is using.

Curriculum content will have explicit versions.

A learner submission must always be traceable to the exact challenge and test-pack version used during evaluation.

## Consequences

Positive:

- Git history
- reviewable changes
- easy rollback
- reproducible cohorts
- AI assistants can work directly with curriculum files

Negative:

- non-technical content editors cannot edit through a graphical CMS initially

A CMS may be added later without changing the underlying curriculum model.