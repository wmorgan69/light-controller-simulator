# Repository agent instructions

## Project context and scoped guidance

- The solution targets .NET 11 (`Devices.slnx`); frontends use React, TypeScript, Material UI, Vite, and Three.js. See `package.json` and CI for supported tools.
- Read relevant sections of `docs/plans/plan.md` before broad feature changes. Current source and tests take precedence over superseded proposals.
- Load only applicable guidance below, including when following dependencies beyond the initial diff. Clients supporting path-scoped instructions can load these files automatically; otherwise read the relevant files explicitly. Do not load every guide for every task.

| Work being inspected or changed | Guidance |
|---|---|
| .NET, shared contracts, API/state/configuration | [Runtime rules](.github/instructions/runtime.instructions.md) |
| Either frontend, browser behavior/tests, recording helpers | [Browser rules](.github/instructions/browser.instructions.md) |
| Changed executable behavior or tests | [Testing rules](.github/instructions/testing.instructions.md) |
| Markdown, diagrams, or documentation updates | [Documentation rules](.github/instructions/documentation.instructions.md) |

## Implementation standards

- Make surgical changes; preserve behavior and public contracts unless intentionally changed and documented. Follow existing naming, structure, helpers, and dependency boundaries.
- Prefer small, single-purpose methods and clear types. Avoid speculative abstractions, duplicate logic, unnecessary dependencies/casts, and unrelated cleanup.
- Never log or commit secrets, credentials, personal data, or sensitive payloads. Surface failures explicitly; do not hide errors with success-shaped fallbacks.
- Keep configuration in existing mechanisms; do not silently hide missing required settings. Remove temporary files and diagnostic-only code.
- Update directly affected documentation with behavior, API, configuration, protocol, source-tree, workflow, and UX changes.

## Agent investigation and review handoffs

- Start from the task diff: use the agreed PR base for branch changes and include task-related staged, unstaged, and untracked files. Preserve unrelated worktree changes.
- Inspect changed code plus affected callers, contracts, tests, and documentation. Expand for concrete dependency, regression, or security evidence; state why expansion is needed. Changed paths are not an access allowlist.
- Avoid generated `bin/`, `obj/`, `node_modules/`, bundles, coverage dumps, databases, and lockfile dumps unless relevant; dependency changes still require targeted manifest/lockfile inspection.
- Handoffs must include objective, comparison base/reviewed revision, changed paths, behavior and risk summary, relevant guidance, exact validation results, and available coverage/browser evidence.
- Reuse supplied evidence if it covers the current revision and scope. Do not repeat discovery, builds, coverage collection, or browser setup merely to reproduce valid evidence.
- All agents may inspect relevant files anywhere in the repository. Reviewers remain read-only and independent of implementation. Tool permissions still apply; these instructions do not grant access.

## Required implementation workflow

1. Inspect affected code, tests, and relevant specifications before editing.
2. Implement and add focused regression/behavior tests following the scoped testing rules.
3. Run the smallest applicable checks while iterating and one final applicable validation set. Executable changes require solution build/tests before completion; documentation/instruction-only changes require link/configuration checks, not application builds.
4. Request independent `code-reviewer` review after implementation, including behavioral documentation/instruction changes. Typographical corrections with no behavioral impact need no agent review.
5. Request `ux-reviewer` for user-visible UI changes or documentation describing changed UI behavior. Inspect desktop and narrow-mobile UI when browser tools are available; designate one evidence owner and share captures/results.
6. Request `security-reviewer` for changes to external inputs, API endpoints, authentication/authorization, sensitive data handling, security controls, dependencies, or security workflows. Otherwise record not applicable with a reason.
7. Fix actionable findings, rerun affected checks, and repeat affected reviews on the incremental fix diff and impacted dependencies. Broaden or repeat full validation when fixes invalidate earlier evidence.
8. Report changed files, exact command results/counts, review outcomes, and limitations. Never claim an unperformed check passed.

Use `build-review-rebuild` when a feature/fix should demonstrate the full agent workflow; otherwise avoid an extra coordinator layer. It must preserve independent reviews and evidence.

## Merge requirements

- Merge through a PR, not directly to the protected default branch. Required CI checks and approvals must pass; full CI remains unchanged by local task scoping.
- Record code-review results and applicable UX/security reviews in the PR; mark inapplicable checks with reasons.
- Instructions and checklists guide contributors; only configured repository rules enforce merge gates.
