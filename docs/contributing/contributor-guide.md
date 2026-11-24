# Quick Start: Code Coverage & Security Review

This guide shows you how to work with the new code coverage and security review requirements.

## Before You Start

Make sure you understand:
- **Code coverage ≥ 50%** is enforced on the first report discovered by CI; higher thresholds are proposed, not scheduled.
- **Security review** is requested for changes touching APIs, authentication, or external inputs; repository rules determine what is enforced.
- **Dependabot** is configured for weekly NuGet and npm version updates; npm updates require a manifest in `tests/`. Security alerts are configured separately.

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

### 2. Add Focused Tests (If Coverage Drops)

If the report checked by CI drops below 50%, add tests:

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

Include the changed paths, relevant context, applicable checks, validation results, and available coverage evidence in the review handoff. Follow the [agent investigation and review handoff guidance](../../AGENTS.md#agent-investigation-and-review-handoffs): agents may inspect relevant files anywhere in the repository, handoffs are not file-access allowlists, and permission prompts still apply.

### 5. Request Security Review (If Applicable)

**If your change touches:**
- API endpoints or controllers
- Authentication/authorization
- Input handling or validation
- Sensitive data (tokens, credentials, PII)
- CORS, CSRF, or security headers

**Then request security review:**

Select the `security-reviewer` agent in an environment that supports the repository's custom agents, and record its findings in the PR. A GitHub comment alone does not guarantee that the agent runs.

**What the security reviewer will check:**
- Input validation and sanitization
- Authentication and authorization
- Sensitive data handling
- Error messages don't leak internals
- Dependencies are secure

**If vulnerabilities are found:**
1. The reviewer reports findings with severity and suggested fixes; record them in the PR
2. Fix the issues
3. Request an independent re-review and record the result

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

```
1. Implement feature
         ↓
2. Add focused tests (if needed)
         ↓
3. `dotnet test` passes, coverage ≥ 50%
         ↓
4. Push PR (CI will verify coverage automatically)
         ↓
5. Request code review
         ↓
6. If security-sensitive: Request security review
         ↓
7. Address feedback
         ↓
8. Code review approves → Merge
```

## See Also

- [Quality & Security Implementation](quality-and-security.md) - In-depth guide, phased approach, Codecov setup
- [Branch Protection Configuration](branch-protection.md) - GitHub branch protection setup
- [Project Plan](../plans/plan.md) - Architecture and project goals
- [AGENTS.md](../../AGENTS.md) - Agent definitions and workflow
