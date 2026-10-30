# Exam1 restricted Go function submissions

These rules apply only to an Exam1 item whose frozen execution contract explicitly selects restricted function ABI version 3. They do not change Quests, legacy function ABI1, program ABI2, or public Run.

Submit the single original `.go` filename shown in the question, with `package piscine`. Keep the required function name and exact signature. Helper functions, methods, type declarations, constants, local variables, conditions, and loops are allowed.

The entire submitted file must contain:

- No imports, including blank imports, dot imports, or `import "C"`.
- No `init` function and no package-level variables.
- No `go` statements or goroutines.
- No compiler, linker, build, export, or line directives in comments.

Do not submit additional files. Do not print output from these functions. Unexpected stdout or stderr produces a runtime error. Source that violates the restricted profile is rejected as a compilation error before a compiler sandbox is created.

The five supported profiles are `(int, int) -> int`, `(*int, int) -> void`, `([]int, int, int) -> int`, `(string) -> int`, and `([]int) -> int`. Pointer questions check the pointer value after the call. The two slice profiles explicitly require preservation: the returned integer and a copied slice observation taken immediately after the call are checked. Nil and empty slices remain distinct.

## Source implementation boundary

The trusted host validates the full source AST and every parsed comment, rejects any extra learner file, and preserves the original filename and source bytes. Existing snapshot/storage identity checks bind the submitted bytes to their recorded digest. The compiler receives only that file, a fixed generated public caller, and a fixed offline module definition. Only the trusted compiler command creates the two fixed package directories. The flat archive path checks remain unchanged.

The generated caller assigns the learner function to an explicit exact Go function type before invoking it. Returned values therefore use the built-in `int` and `[]int` types; a named return type with a custom JSON marshaler cannot replace the required signature. Trusted code copies slice contents immediately after each return, preserving nil and empty distinctions. The host validates typed private inputs and expected integers before execution; only input values are sent to the caller. Expected integers and preservation comparisons remain on the host. No private harness or expected answers enter the sandbox.

The fixed launcher keeps the caller's JSON stream on descriptor 3 and captures ordinary stdout/stderr separately. Descriptor separation alone does not authenticate arbitrary Go code. The assurance here depends on the complete restricted source subset, the exact single-file inventory, exact typed function binding, trusted caller bytes, pinned Go/target environment, and existing sandbox resource/isolation controls. This source change does not authorize unrestricted learner code, public Run enablement, live sandbox execution, pack publication, deployment, or a grading policy.

Source unit tests may compile and execute only constant, trusted transport fixtures. Fake engines exercise runner failure/cleanup paths. Passing these checks supports the restricted source implementation; it is not evidence of a live service or published private pack.
