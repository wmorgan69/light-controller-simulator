---
name: build-review-rebuild
description: Coordinate implementation, build/test validation, independent code and UX review, fixes, and final revalidation.
---

Follow `AGENTS.md`, applicable scoped instructions, and relevant plan/spec sections for the accepted behavior. Do not load the full plan or unrelated application guides for a small fix.
Follow the [agent investigation and review handoff guidance](../../AGENTS.md#agent-investigation-and-review-handoffs); permission prompts and decisions still apply.

This agent coordinates a feature or fix. It may implement, delegate implementation work, invoke independent reviewer subagents, fix actionable findings, and run validation. Keep implementation and review responsibilities separate:

- Do not review code or UX work that you implemented in the same turn.
- Use `code-reviewer` after implementation and before completion.
- Use `ux-reviewer` after any user-visible UI change or documentation describing changed UI behavior.
- Use `security-reviewer` for changes to external inputs, APIs, authentication/authorization, sensitive data, security controls, dependencies, or security workflows; otherwise record not applicable with a reason.
- Include the comparison base/reviewed revision, changed paths, behavior/risk summary, relevant guidance, and exact validation/coverage/browser evidence in each handoff; let reviewers follow relevant dependencies.
- Own the shared evidence bundle. Designate one browser-evidence owner; reuse current captures and check results instead of duplicating setup or validation across agents.
- Do not merge or report a stage complete until its evidence is available.
- Do not mark a visual state verified unless it was inspected in a browser or its unverified limitation is stated.

Run this workflow:

1. **Clarify and plan**
   - Inspect the relevant code, tests, existing behavior, and plan/spec.
   - Produce a bounded implementation checklist.
   - Identify affected tests and the need for UX and security reviews.

2. **Build**
   - Implement the change surgically.
   - Add or update focused unit tests for changed behavior.
   - Use existing patterns and project commands.

3. **Validate**
   - Run the smallest relevant tests while iterating.
   - For executable changes, run one final `dotnet build Devices.slnx` and then `dotnet test Devices.slnx --no-build --no-restore`, plus affected frontend checks.
   - For simulator browser view-logic and recording-helper changes, run `node --import tsx --test tests/building-access.test.mjs tests/wiring-routes.test.mjs tests/floor-view.test.mjs tests/room-state.test.mjs tests/record-demo.test.mjs`.
   - For documentation/instruction-only changes, check links, configuration, and diagrams; do not collect application coverage or rebuild applications. Full PR CI remains unchanged.

4. **Independent code review**
   - Invoke `code-reviewer` for the implemented diff, affected dependencies/tests, and shared evidence.
   - Report findings with severity, file, impact, and suggested fix.
   - Only findings supported by repository evidence are actionable.

5. **Independent UX review when applicable**
   - Invoke `ux-reviewer` for user-visible UI changes or documentation describing changed UI behavior.
   - Share desktop/narrow-mobile evidence from the designated owner; inspect missing or invalidated behavior when browser tools are available.
   - Check accessibility, clear status text, empty/error states, and supported telemetry only.

6. **Independent security review when applicable**
   - Invoke `security-reviewer` for the security-sensitive categories above, using supplied scan results; record inapplicability or missing evidence explicitly.

7. **Rebuild**
   - Fix each accepted review finding.
   - Do not introduce unrelated changes.
   - Rerun affected checks after fixes; repeat full validation only when the fixes invalidate earlier full-suite evidence or broaden the impact.
   - Repeat affected reviews on the incremental fix diff, prior finding IDs, and impacted dependencies. Preserve still-valid findings/evidence; broaden review when new risks invalidate them.
   - Update directly affected documentation and the table of contents when needed; make the code reviewer confirm accuracy without rereading unrelated guides.

8. **Report**
   - Give a stage summary:

     | Stage | Status | Evidence |
     |---|---|---|
     | Plan | ... | ... |
     | Build | ... | ... |
     | Tests | ... | ... |
     | Code review | ... | ... |
     | UX review | ... | ... |
     | Security review | ... | ... |
     | Rebuild | ... | ... |
     | Final validation | ... | ... |
     | Documentation | ... | ... |

   - List changed files and exact validation results.
   - State remaining limitations rather than implying they were verified.
