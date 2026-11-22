# Repository agent instructions

## Project context

- Read `docs/plan.md` before making broad feature changes. Treat the current source and tests as authoritative where the original plan describes proposals that have since changed.
- Keep changes surgical and follow existing project patterns.
- The solution targets .NET 11 and is built from `Devices.slnx`.

## Required implementation workflow

1. Inspect the affected code, tests, and relevant plan/spec sections before editing.
2. Implement the change and add or update focused tests for changed behavior.
3. Run the relevant tests and build. At minimum, use `dotnet build Devices.slnx` and `dotnet test Devices.slnx` for solution-wide changes.
4. After implementation, request an independent review with the `code-reviewer` agent. For any user-visible UI change, also request the `ux-reviewer` agent and inspect the running UI at desktop and narrow-mobile widths when browser tools are available. For changes that add external inputs, API endpoints, or authentication/authorization logic, also request the `security-reviewer` agent.
5. If a reviewer identifies an actionable issue, fix it, rerun affected tests/build checks, and repeat the affected review. Do not report a review as complete if it could not be run; report the limitation instead.
6. Summarize changed files, validation results, review findings, and any remaining limitations.

Reviewers are read-only and must not review their own changes. Code review checks correctness, regression risk, and **code coverage impact** (new code is tested and overall coverage doesn't regress below phase threshold); UX review checks task clarity, visual hierarchy, responsive behavior, accessibility, and status/error states; security review checks OWASP Top 10 UI and API vulnerabilities.

## Documentation standards

- Keep `docs/README.md` as the documentation table of contents and update it whenever a new top-level guide is added.
- Maintain separate guides for the [Building Light Simulator](docs/building-light-simulator.md) and [Lighting Instrumentation](docs/lighting-instrumentation.md) applications.
- Update affected documentation in the same change as code behavior, API, configuration, protocol, source-tree, workflow, or UX changes.
- Describe current behavior rather than proposed behavior as implemented. Move unimplemented ideas to explicit "remaining/open" sections.
- Include a Mermaid diagram when a change introduces or alters a system boundary, state flow, message flow, runtime sequence, or major component relationship.
- Keep source-tree documentation representative rather than listing generated `bin/`, `obj/`, or transient SQLite artifacts.
- Use stable, repository-relative Markdown links and keep the table of contents synchronized with headings.
- Use examples that can be run from the repository root. Document ports, configuration keys, HTTP endpoints, MQTT topics, test commands, and current defaults.
- Before completion, verify every new or changed Markdown link and Mermaid block, and remove contradictions with `docs/plan.md`, source code, and the running UI.

The code reviewer must confirm that documentation is complete and accurate for the changed implementation. Documentation-only changes still require a code review unless the change is a correction with no behavioral impact; UX documentation changes require UX review when they describe UI behavior.

For features and fixes that should visibly demonstrate the full agent workflow, use the `build-review-rebuild` custom agent. It coordinates planning, implementation, build/test validation, independent code review, applicable UX review, fixes, re-review, and final reporting. It must keep reviewers independent from the implementation work and must not imply that an unperformed stage passed.

## Clean code and implementation standards

- Prefer small, single-purpose methods and classes with clear names. Optimize for readability and predictable behavior rather than cleverness.
- Keep functions and modules within a reasonable level of complexity. Extract policy from setup, parsing from rendering, and infrastructure from domain behavior when that improves testability.
- Avoid duplicate logic, speculative abstractions, unused code, large patch rewrites, and unrelated cleanup. Fix tightly coupled issues when necessary, but do not change unrelated behavior.
- Follow existing .NET naming, namespace, file placement, dependency-injection, nullable, async, and test patterns. Do not introduce a new framework or architectural pattern without a demonstrated need.
- Preserve existing public contracts unless a change is intentional and documented. Validate external input at API boundaries and return explicit HTTP errors rather than success-shaped fallbacks.
- Never log or commit secrets, personal data, bearer tokens, connection credentials, or sensitive payloads. Fail safely and surface operational errors clearly.
- Use cancellation tokens for cancellable asynchronous operations and avoid blocking async code. Keep hosted services and polling refreshes bounded and non-overlapping.
- Keep configuration in existing configuration mechanisms. Use safe defaults, but do not silently hide missing required configuration.
- Preserve type safety: avoid unnecessary casts, `dynamic`, or unvalidated deserialization. Use existing models and serializers instead of duplicating contract shapes.
- Remove temporary files and avoid leaving diagnostic-only code in the final change.

## Testing standards

- Add or update unit tests for every behavior introduced or changed. Test observable behavior and state transitions, not implementation details or constants.
- Prefer focused tests that would fail if the change were absent. Add coverage for normal, boundary, invalid-input, and failure cases that are meaningful to the behavior.
- Keep tests deterministic and isolated. Do not rely on timing sleeps, real brokers, real MQTT services, external network access, wall-clock assumptions, or machine-specific paths.
- Use the existing test framework and project structure; prefer xUnit and the current test helpers/patterns.
- Before changing a bug, identify or add a regression test that reproduces the bug. If a browser-only issue cannot be covered by existing test infrastructure, document the browser verification and add lower-level tests for any newly testable behavior.
- Run the smallest relevant test set while iterating, then run the solution build/tests before completion. Report exact commands and pass/fail counts.
- Do not write tests that merely restate an implementation or assert framework/library behavior. Tests should protect project requirements and catch regressions.

## API and state-transition standards

- Update one authoritative state model and derive UI or published telemetry from it.
- Mutation endpoints should return the resulting state needed by callers. Do not require a separate refresh when the API response already establishes correctness.
- Clearing or changing faults must recompute controller status and related visual state from the remaining faults.
- Stable IDs are required for controllers, rooms, sensors, faults, and light strips. Do not derive UI keys from display text.
- MQTT publication must not block or delay HTTP mutation responses; HTTP is the source of current state for browser interactions in the current architecture.

## UI implementation standards

- Follow existing markup, CSS, rendering, and accessibility patterns. Keep UI state synchronized with server-returned state and avoid stale optimistic updates.
- Use semantic HTML and meaningful labels/headings. Status must not rely on color alone; pair color with text or an icon.
- Keep loading, waiting, empty, error, healthy, faulted, and offline states visually and programmatically distinct.
- Do not display metrics or trends that lack a source in the telemetry contracts.
- Verify live data and important state transitions in a browser for user-visible changes. Check desktop and narrow-mobile widths and check for horizontal overflow.
- Respect reduced-motion and keyboard needs. Keep browser-only interactions mirrored by an accessible non-3D or API path where the feature requires control.

## Code review acceptance criteria

The code reviewer must check each applicable item and report:

- Whether the change preserves intended behavior and contracts.
- Whether state mutation and fault/status transitions are correct and race-safe.
- Whether all external and invalid inputs are handled explicitly.
- Whether focused tests cover the new behavior and meaningful edge/failure cases.
- **Whether code coverage impact is acceptable** (new code is tested; overall coverage is not regressing below current phase threshold ≥50%). Reference Codecov PR comments or request coverage report from developer.
- Whether the change follows existing structure, dependency boundaries, and clean-code conventions.
- Whether secrets, unnecessary dependencies, duplicated logic, blocking calls, or unrelated changes are introduced.

## Merge requirements

- Changes are merged through a pull request, not directly to the protected default branch.
- The required CI build/test check must pass before merge.
- PRs must record code-review results; UI changes must also record UX-review results.
- Instructions and PR checklists guide contributors, but only repository rules such as required status checks and required approvals block a merge.
