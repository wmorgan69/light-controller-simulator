# Branch Protection Configuration

This document describes the recommended GitHub branch protection settings for enforcing code quality, security, and testing requirements.

## Setup Instructions

### 1. Navigate to Repository Settings

1. Go to your repository on GitHub
2. Click **Settings** → **Branches**
3. Under "Branch protection rules", click **Add rule**
4. Enter `main` as the branch name pattern

### 2. Configure Required Status Checks

Enable the following checkboxes:

- [x] **Require a pull request before merging**
  - Require approval from at least 1 (or more) code owners
  - Dismiss stale pull request approvals when new commits are pushed

- [x] **Require status checks to pass before merging**
  - Require branches to be up to date before merging

**Required status checks:**
- `.NET validation` (from CI workflow: `ci.yml`)
  - This includes build, test, code coverage >= 90%, and smoke tests

**Future additions (once configured):**
- Security vulnerability scanning (Dependabot)
- Code coverage badge (Codecov)

### 3. Restrict Who Can Push

- [x] **Restrict who can push to matching branches**
  - Restrict push access to administrators only (optional, based on team policy)

### 4. Enable Additional Protections

- [x] **Require code reviews before merging**
  - Number of reviewers: 1
  - Dismiss stale pull request approvals: Yes
  - Require review from code owners: Yes (if `CODEOWNERS` file exists)

- [x] **Require conversation resolution before merging**
  - Ensures all comments/discussions are resolved

## CI/CD Enforcement

### Code Coverage (>= 90%)

The CI workflow (`ci.yml`) will:
1. Run all tests with code coverage collection: `dotnet test Devices.slnx --collect:"XPlat Code Coverage"`
2. Extract coverage percentage from `coverage.cobertura.xml`
3. Fail the build if coverage < 90%
4. Upload results to Codecov for tracking and visualization

**Status check name:** `.NET validation` (includes coverage enforcement)

### Security Scanning

#### Dependabot (GitHub Native)
- Automatically scans NuGet and npm dependencies for vulnerabilities
- Opens PRs for security updates
- Configured via `.github/dependabot.yml`

#### Manual Security Reviews
- For PRs that add external inputs, API endpoints, or authentication logic, request the `security-reviewer` agent
- Security reviewer checks for OWASP Top 10 UI & API vulnerabilities
- Security review results are documented in PR comments

### Codecov Integration

Once you set up Codecov:

1. **Connect repository to Codecov**
   - Visit https://codecov.io
   - Sign up and authorize GitHub
   - Add your repository

2. **Add Codecov token to GitHub Secrets**
   - In Codecov: Settings → Repositories → `<repo>` → Copy token
   - In GitHub: Settings → Secrets and variables → Repository secrets
   - Add secret: `CODECOV_TOKEN`

3. **Configure status check**
   - Codecov can optionally be a required status check
   - GitHub Settings → Branches → Branch protection rule
   - Add `codecov/patch` and/or `codecov/project` as required status checks

## Merge Checklist

Before merging a PR, verify:

- [ ] All CI status checks pass (`.NET validation`)
- [ ] Code review is approved
- [ ] Security review is approved (if applicable)
- [ ] UX review is approved (if UI changes)
- [ ] Code coverage is >= 90%
- [ ] No unresolved conversations
- [ ] PR description clearly explains the change and testing performed
- [ ] No secrets or sensitive data committed

## Monitoring & Dashboards

### Codecov Dashboard

View coverage trends at: `https://codecov.io/gh/YOUR_ORG/YOUR_REPO`

Tracks:
- Overall project coverage
- Coverage by branch
- Coverage by file
- Historical coverage trends

### GitHub Actions Dashboard

Monitor CI status at: `https://github.com/YOUR_ORG/YOUR_REPO/actions`

Shows:
- Workflow run status
- Test results
- Build logs
- Coverage enforcement results

### Dependabot Alerts

Monitor security updates at: `https://github.com/YOUR_ORG/YOUR_REPO/security/dependabot`

Shows:
- Vulnerable dependencies
- Recommended fixes
- Auto-generated PRs

## Troubleshooting

### "Coverage enforcement failed: 85% < 90%"

This means your test suite is not covering enough code paths. Options:

1. **Add focused tests** for uncovered branches (preferred)
2. **Document exclusions** for uncoverable code (e.g., defensive nullability checks)
3. **Review coverage reports** in Codecov to identify coverage gaps

To view coverage locally:
```bash
dotnet test Devices.slnx --collect:"XPlat Code Coverage"
```

Coverage XML files are in: `tests/**/coverage.cobertura.xml`

### "No CODECOV_TOKEN found"

The CI step will not upload to Codecov without the token, but coverage enforcement is still local. To enable Codecov:

1. Set up account at https://codecov.io
2. Add `CODECOV_TOKEN` to GitHub repository secrets
3. Re-run CI workflow

### "Security-reviewer agent not found"

The agent is defined in `.github/agents/security-reviewer.agent.md`. When requesting a review:

```
@security-reviewer Please review this change for OWASP vulnerabilities
```

The agent will analyze the diff and report findings.

## References

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Codecov Documentation](https://docs.codecov.io/)
- [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot)
- [OWASP Top 10](https://owasp.org/Top10/)
- [.NET Code Coverage](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-code-coverage)
