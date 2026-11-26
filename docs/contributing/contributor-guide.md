# Quick Start: Code Coverage & Security Review

This guide shows you how to work with the new code coverage and security review requirements.

## Before You Start

Make sure you understand:
- **Code coverage ≥ 50%** is enforced on the first report discovered by CI; higher thresholds are proposed, not scheduled.
- **Security review** is requested for changes to existing or new APIs, external inputs, authentication/authorization, sensitive data handling, security controls, dependencies, or security workflows; repository rules determine what is enforced.
- **Dependabot** is configured for weekly NuGet, npm, and GitHub Actions version updates at the repository root. Security alerts are configured separately.

## Bounded Agent Workflow

The repository uses diff-first implementation/review, scoped instructions, and shared validation evidence to reduce repeated AI work without restricting reviewers to changed files or weakening full PR CI.

### Scoped instructions

[AGENTS.md](../../AGENTS.md) contains universal rules and routes tasks to [.github/instructions](../../.github/instructions/). The instruction files use `applyTo` globs for clients that support path-scoped loading. Other clients must follow the root routing table and read applicable files explicitly. Automatic loading varies by client; verify loaded customizations there, and refresh/start a new session if instructions were already loaded. Splitting files does not save context if a client loads them all.

| Scope | Guidance |
|---|---|
| .NET, contracts, API/state/configuration | [Runtime](../../.github/instructions/runtime.instructions.md) |
| Simulator/instrumentation frontends, browser tests and recording helpers | [Browser](../../.github/instructions/browser.instructions.md) |
| Executable behavior and tests | [Testing](../../.github/instructions/testing.instructions.md) |
| Markdown and diagrams | [Documentation](../../.github/instructions/documentation.instructions.md) |

The existing application folders remain intact. Shared-contract changes require following relevant consumers across application boundaries. Load the affected application's design guide, not both guides by default.

### Diff-first handoffs and incremental re-review

Agree the comparison base rather than assuming every task targets `main`. For example, these read-only commands show a PR branch diff and local changes from the repository root:

```powershell
# Replace origin/main with the agreed, locally available PR base.
$base = 'origin/main'
git --no-pager diff --name-status "$base...HEAD"
git --no-pager diff "$base...HEAD"
git --no-pager diff HEAD
git ls-files --others --exclude-standard
```

The branch comparison uses the merge base; `git diff HEAD` includes staged and unstaged tracked changes. Untracked task files must be inspected separately. Do not include unrelated worktree changes in the task or revert them.

Each handoff includes:

- Objective, comparison base and reviewed revision (including relevant uncommitted changes).
- Changed paths, behavior/risk summary, affected callers/contracts/tests, and applicable instruction/guide references.
- Exact validation commands and results/counts, coverage scope/baseline when available, and limitations.
- Browser evidence owner, revision, viewport sizes, captures, and actions/states checked when UI is affected.

Review changed code plus affected dependencies. Expand for concrete regression/security evidence and explain why; paths are not an access allowlist. Avoid generated output and large report/lockfile dumps unless relevant; inspect dependency deltas when manifests or lockfiles change.

After review fixes, supply the incremental fix diff, prior findings, impacted dependencies, and updated check results. Repeat affected reviews only; retain still-valid results. Broaden review and repeat full validation when fixes invalidate earlier evidence or introduce wider risks.

### Validation and specialist review

- Run targeted tests while iterating, then one applicable final validation set. Executable changes still require solution build/tests and affected frontend checks.
- Documentation/instruction-only local validation checks links, configuration, and diagrams; application builds and coverage are not applicable. Full required PR CI is unchanged.
- Code review remains independent. UX review applies to user-visible UI changes and documentation describing changed UI behavior.
- Security review applies to external inputs, APIs, authentication/authorization, sensitive data, security controls, dependencies, and security workflows. Otherwise record not applicable with a reason.
- Share current validation and scan results rather than rerunning them for each agent. Use one browser-evidence owner; repeat captures only for missing/invalidated checks. Screenshots alone do not verify live interaction or keyboard behavior.
- Reuse affected-runtime coverage evidence. The >=50% CI gate checks the first .NET report, not combined coverage or every regression; frontend V8 coverage is separate. Do not request .NET coverage for frontend-only changes.

### Model selection and cost measurement

Agent profiles do not pin models; actual selection and billing depend on the client and plan. Use a lower-cost available model for routine execution/lookups and reserve stronger models for difficult implementation or high-risk review. Configure supported client model/subagent settings rather than adding speculative model names to repository files.

Use the coordinator for an explicit full-workflow demonstration, not as an extra layer for every small task. Prefer concise evidence bundles and actionable findings. Check actual usage/billing before and after comparable tasks: smaller instruction files and fewer repeated calls are opportunities, not a guaranteed spending reduction. User/editor model settings are not changed by this repository update.

## Working on Code Changes

### 1. After Implementation: Run Local Tests

```bash
# Build and run all tests with coverage
dotnet build Devices.slnx
dotnet test Devices.slnx --no-build --no-restore --collect:"XPlat Code Coverage"
```

Coverage XML files appear in: `tests/**/TestResults/*/coverage.cobertura.xml`

The CI workflow adds simulator view-logic and recording-helper Node tests and a Docker Compose smoke test. To run a focused subset of the Node tests and start the Compose services locally:

```powershell
node --import tsx --test tests/building-access.test.mjs tests/wiring-routes.test.mjs tests/floor-view.test.mjs tests/room-state.test.mjs tests/record-demo.test.mjs
docker compose up --build -d
```

The Compose command above only starts the services; it does not run the [CI smoke-test checks](../../.github/workflows/ci.yml). Stop local services with `docker compose down` when finished. The CI smoke test verifies the simulator controller count and confirms that a room-presence mutation is rejected with HTTP 403. It checks that instrumentation receives the initial unoccupied room state over HTTP while MQTT is disconnected, then stops both services and recreates only instrumentation to verify that state is restored from SQLite while the simulator is offline. Readiness GET requests have bounded retries, including connection resets; the rejected POST is not retried. The CI job cleans up its disposable Compose resources after the check.

### 2. Check Focused Tests and Coverage

Add tests for introduced/changed behavior regardless of the coverage threshold. If the report checked by CI drops below 50%, address the missing coverage:

```bash
# Tests are in tests/Devices.*.Tests/
# Add tests that cover your new code paths
```

**Where to add tests:**
- **Simulator tests**: `tests/Devices.Simulator.Tests/BuildingSimulatorTests.cs`
- **Instrumentation tests**: `tests/Devices.Instrumentation.Tests/TelemetryStoreTests.cs`
- **Input validation**: Create a new test class named `*ValidationTests.cs`

**Test style** (follow existing patterns):
```csharp
[Fact]
public void MyNewFeature_WithValidInput_ReturnsExpected()
{
    // Arrange
    var input = new MyInput { /* ... */ };
    
    // Act
    var result = MyMethod(input);
    
    // Assert
    Assert.NotNull(result);
    Assert.Equal(expected, result.Value);
}
```

### 3. Create a Pull Request

Fill out `.github/PULL_REQUEST_TEMPLATE.md`, retaining its headings and recording actual validation and review results.

### 4. Request Code Review

Use the [diff-first handoff](#diff-first-handoffs-and-incremental-re-review), including available coverage evidence for executable changes. Follow the [agent investigation and review handoff guidance](../../AGENTS.md#agent-investigation-and-review-handoffs): agents may inspect relevant files anywhere in the repository, handoffs are not file-access allowlists, and permission prompts still apply.

### 5. Request Security Review (If Applicable)

**If your change touches:**
- API endpoints or controllers
- Authentication/authorization
- Input handling or validation
- Sensitive data (tokens, credentials, PII)
- CORS, CSRF, or security headers
- Dependencies or security workflows

**Then request security review:**

Select the `security-reviewer` agent in an environment that supports the repository's custom agents, and record its findings in the PR. A GitHub comment alone does not guarantee that the agent runs.
For other changes, record not applicable with a reason rather than running a redundant specialist review.

**What the security reviewer will check:**
- Input validation and sanitization
- Authentication and authorization
- Sensitive data handling
- Error messages don't leak internals
- Dependencies are secure

**If vulnerabilities are found:**
1. The reviewer reports findings with severity and suggested fixes; record them in the PR
2. Fix the issues
3. Request an independent re-review of the fixes and impacted trust boundaries, sharing updated evidence, and record the result

### 6. Address Dependabot PRs

If Dependabot opens a dependency update PR:
- Review the PR description
- Check the CI workflow passes
- Approve and merge (Dependabot PRs run full CI)

## Incrementally Improving Coverage

You don't need to reach 90% immediately. The phased approach is:

1. **Phase 1 (current)**: 50% threshold
   - Checks the first discovered coverage report
   - Establishes CI/coverage-collection workflows

2. **Phase 2 (proposed)**: 60% threshold
   - Add tests for critical business logic paths
   - Focus on API contracts and state mutations

3. **Phase 3 (proposed)**: 75% threshold
   - More comprehensive coverage
   - Add integration tests for complex scenarios

4. **Phase 4 (proposed)**: 90% threshold
   - Full coverage of business logic
   - May exclude hard-to-test UI/rendering code with documentation

**Strategy for reaching 90%:**
- Focus on **business logic first** (easiest to test, highest impact)
- **Test browser logic separately**: the .NET coverage report does not measure JavaScript 3D rendering.
- **Add integration tests** for critical scenarios (room selection → presence → fault → state update)
- **Incrementally add** unit tests as you change code

## Common Questions

### "My change is infrastructure-only (e.g., dependency update). Can I skip coverage?"

CI still checks its first discovered report. A change without new logic does not by itself guarantee that the check passes.

### "Coverage dropped 1% due to my change. Do I need to add tests?"

Depends on the threshold:
- If the first report discovered by CI is ≥ 50%, the coverage gate passes; it does not check combined solution coverage or detect every regression.
- If that report is below 50%, add tests for your code paths.

### "Can I exclude code from coverage?"

For C# code, consider exclusions only when justified and document the reason. Verify the exclusion configuration against the Coverlet collector used by CI. JavaScript rendering is not part of the .NET coverage report.

### "I disagree with a security finding. Can I ignore it?"

You can override with code review approval, but:
1. Document your reasoning in a PR comment
2. Code reviewer must explicitly approve the override
3. Add a code comment explaining why the code is safe

## Workflow Summary

![Agent workflow: inspect the task diff, implement with focused tests, share applicable validation evidence, and request independent code and applicable UX/security review. Findings loop through fixes and affected checks for incremental re-review; completion records outcomes and requires full PR CI and approvals.](../assets/diagrams/agent-workflow.svg)

## See Also

- [Quality & Security Implementation](quality-and-security.md) - In-depth guide, phased approach, Codecov setup
- [Branch Protection Configuration](branch-protection.md) - GitHub branch protection setup
- [Project Plan](../plans/plan.md) - Architecture and project goals
- [AGENTS.md](../../AGENTS.md) - Agent definitions and workflow
