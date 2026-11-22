# Quick Start: Code Coverage & Security Review

This guide shows you how to work with the new code coverage and security review requirements.

## Before You Start

Make sure you understand:
- **Code coverage ≥ 50%** is now enforced by CI (Phase 1; will increase to 60%, 75%, then 90%)
- **Security review** is required for PRs touching APIs, authentication, or external inputs
- **Dependabot** will scan dependencies weekly and open PRs for security updates

## Working on Code Changes

### 1. After Implementation: Run Local Tests

```bash
# Build and run all tests with coverage
dotnet build Devices.slnx --no-restore
dotnet test Devices.slnx --no-build --no-restore --collect:"XPlat Code Coverage"
```

Coverage XML files appear in: `tests/**/TestResults/*/coverage.cobertura.xml`

### 2. Add Focused Tests (If Coverage Drops)

If your change drops overall coverage below 50%, add tests:

```bash
# Tests are in tests/Devices.*.Tests/
# Add tests that cover your new code paths
```

**Where to add tests:**
- **API controllers**: `tests/Devices.Simulator.Tests/Controllers/` or `tests/Devices.Instrumentation.Tests/Controllers/`
- **State logic**: `tests/Devices.Simulator.Tests/Models/` or similar
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

Fill out `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Summary
Brief description of the change

## Validation
- [x] Relevant tests pass
- [x] `dotnet build Devices.slnx` passes
- [x] `dotnet test Devices.slnx` passes  
- [x] Code coverage is >= 50% (checked in CI)

## Security & Dependencies
- [x] Security review completed OR this change is not security-sensitive
- [x] No secrets committed
- [x] New inputs are validated (if applicable)

## Independent reviews
- [ ] Code review completed
- [ ] Security review completed (if security-sensitive)
- [ ] UX review completed (if UI changes)
```

### 4. Request Code Review

Mention that the change has been tested and coverage is maintained.

### 5. Request Security Review (If Applicable)

**If your change touches:**
- API endpoints or controllers
- Authentication/authorization
- Input handling or validation
- Sensitive data (tokens, credentials, PII)
- CORS, CSRF, or security headers

**Then request security review:**

Comment in the PR:
```
@security-reviewer Please review this change for OWASP Top 10 vulnerabilities.
```

**What the security reviewer will check:**
- Input validation and sanitization
- Authentication and authorization
- Sensitive data handling
- Error messages don't leak internals
- Dependencies are secure

**If vulnerabilities are found:**
1. The agent will post findings with severity and suggested fixes
2. Fix the issues
3. Comment: `@security-reviewer Please re-review`

### 6. Address Dependabot PRs

If Dependabot opens a PR with security updates:
- Review the PR description
- Check the CI workflow passes
- Approve and merge (Dependabot PRs run full CI)

## Incrementally Improving Coverage

You don't need to reach 90% immediately. The phased approach is:

1. **Phase 1 (Now - 1 month)**: 50% threshold
   - Prevents coverage regression
   - Establishes CI/coverage-collection workflows

2. **Phase 2 (1-2 months)**: 60% threshold
   - Add tests for critical business logic paths
   - Focus on API contracts and state mutations

3. **Phase 3 (2-3 months)**: 75% threshold
   - More comprehensive coverage
   - Add integration tests for complex scenarios

4. **Phase 4 (3+ months)**: 90% threshold
   - Full coverage of business logic
   - May exclude hard-to-test UI/rendering code with documentation

**Strategy for reaching 90%:**
- Focus on **business logic first** (easiest to test, highest impact)
- **Skip 3D/animation code** if truly untestable (mark with `[ExcludeFromCodeCoverage]`)
- **Add integration tests** for critical scenarios (room selection → presence → fault → state update)
- **Incrementally add** unit tests as you change code

## Common Questions

### "My change is infrastructure-only (e.g., dependency update). Can I skip coverage?"

No, CI will still check. But if you don't add new logic, coverage should not drop (CI will pass).

### "Coverage dropped 1% due to my change. Do I need to add tests?"

Depends on the threshold:
- If total coverage is still ≥ 50%, CI passes, no action needed.
- If total coverage dropped below 50%, add tests for your code paths.

### "Can I exclude code from coverage?"

Yes, for truly untestable code:

```csharp
[System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage]
public class ComplexAnimationRenderer
{
    // This class renders WebGL animation; has no testable logic
}
```

Then document **why** it's excluded in a code comment or in `docs/quality-and-security.md`.

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
3. `dotnet test` passes, coverage ≥ 60%
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
- [Project Plan](plan.md) - Architecture and project goals
- [AGENTS.md](../AGENTS.md) - Agent definitions and workflow
