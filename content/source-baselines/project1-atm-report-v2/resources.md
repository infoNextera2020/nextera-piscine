# Supplied optional references

Use the supplied input and reporting helpers as infrastructure. Implementing scanner/JSON internals is not part of the ATM business task.

- [Scanner.Scan](https://pkg.go.dev/bufio#Scanner.Scan): stopping when no line can be read.
- [ScanLines](https://pkg.go.dev/bufio#ScanLines): line endings and final unterminated lines.

The original input-only demo and the report-only example are separate programs. Neither is the ATM submission or a business test oracle. The learner assignment and README document their local commands and channel differences.

Historical provenance only: [the original ATM project at its pinned revision](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/01-atm-banking-system.md). Follow this approved beginner adaptation for task scope; the historical project has different features/team expectations.
