# ADR-005 — No Browser IDE in the Piscine MVP

## Status

Accepted

## Context

A browser-based IDE would require editor integration, filesystem simulation, execution UX, persistence, terminal behavior, and additional security work.

Piscine learners should already use local development tools such as VS Code, Git, and the terminal.

## Decision

The MVP will not include an in-browser programming environment.

Learners will write code locally and submit required files or project archives.

The challenge manifest defines:

- allowed files
- required files
- allowed extensions
- maximum submission size

Possible future integrations include:

- CLI submission
- Git repository submission
- browser IDE

## Consequences

The MVP remains focused on learning, assessment, progression, and operational validation rather than recreating a development environment.