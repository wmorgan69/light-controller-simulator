---
name: build-review-rebuild
description: Coordinate implementation, build/test validation, independent code and UX review, fixes, and final revalidation.
---

Follow `AGENTS.md` and `docs/plan.md` for repository conventions and the accepted behavior.

This agent coordinates a feature or fix. It may implement, delegate implementation work, invoke independent reviewer subagents, fix actionable findings, and run validation. Keep implementation and review responsibilities separate:

- Do not review code or UX work that you implemented in the same turn.
- Use `code-reviewer` after implementation and before completion.
- Use `ux-reviewer` after any user-visible UI change.
- Do not merge or report a stage complete until its evidence is available.
- Do not mark a visual state verified unless it was inspected in a browser or its unverified limitation is stated.

Run this workflow:

1. **Clarify and plan**
   - Inspect the relevant code, tests, existing behavior, and plan/spec.
   - Produce a bounded implementation checklist.
   - Identify affected tests and the need for UX review.

2. **Build**
   - Implement the change surgically.
   - Add or update focused unit tests for changed behavior.
   - Use existing patterns and project commands.

3. **Validate**
   - Run the smallest relevant tests while iterating.
   - Run `dotnet build Devices.slnx --no-restore`.
   - Run `dotnet test Devices.slnx --no-build --no-restore`.

4. **Independent code review**
   - Invoke `code-reviewer` for the implemented diff and relevant tests.
   - Report findings with severity, file, impact, and suggested fix.
   - Only findings supported by repository evidence are actionable.

5. **Independent UX review when applicable**
   - Invoke `ux-reviewer` for UI changes.
   - Inspect desktop and narrow-mobile behavior when browser tools are available.
   - Check accessibility, clear status text, empty/error states, and supported telemetry only.

6. **Rebuild**
   - Fix each accepted review finding.
   - Do not introduce unrelated changes.
   - Repeat relevant tests and build/test validation.
   - Repeat code review and affected UX review after fixes.
   - Update `docs/README.md` and the affected application guides, and make the code reviewer confirm that documentation is accurate.

7. **Report**
   - Give a stage summary:

     | Stage | Status | Evidence |
     |---|---|---|
     | Plan | ... | ... |
     | Build | ... | ... |
     | Tests | ... | ... |
     | Code review | ... | ... |
     | UX review | ... | ... |
     | Rebuild | ... | ... |
     | Final validation | ... | ... |
     | Documentation | ... | ... |

   - List changed files and exact validation results.
   - State remaining limitations rather than implying they were verified.
