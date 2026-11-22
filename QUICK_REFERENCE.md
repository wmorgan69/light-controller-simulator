# Quick Reference Card

## For Developers

### Before Each PR

```bash
# 1. Build
dotnet build Devices.slnx --no-restore

# 2. Run tests with coverage
dotnet test Devices.slnx --no-build --no-restore --collect:"XPlat Code Coverage"

# 3. Check coverage passes threshold
# (Should see: "✓ Code coverage X.XXX% meets 50% threshold")
```

### PR Template Checklist

```markdown
✓ Validation
  - Tests pass
  - Build passes (dotnet build Devices.slnx)
  - Coverage check passes (≥50%, shown in CI)

✓ Security & Dependencies
  - Security review: Yes/No/Not applicable
  - No secrets committed
  - New inputs validated

✓ Independent reviews
  - Code review (required)
  - Security review (if security-sensitive)
  - UX review (if UI changes)
```

### When to Request Security Review

Request `@security-reviewer` if your PR changes:
- API endpoints or controllers (`Devices.*.Web/Controllers/`)
- Authentication/authorization logic
- Input handling or validation
- Sensitive data (tokens, passwords, PII)
- CORS, CSRF headers, or security headers
- Error handling (should not leak internals)

**Comment in PR**:
```
@security-reviewer Please review this change for OWASP vulnerabilities
```

---

## Coverage Threshold Roadmap

| Timeline | Threshold | Actions |
|----------|-----------|---------|
| **Now** | ≥50% | Establish CI workflow, prevent regression |
| **1 month** | ≥60% | Add tests for critical business logic |
| **2 months** | ≥75% | Comprehensive coverage of core APIs |
| **3+ months** | ≥90% | Full coverage (excluding hard-to-test code) |

---

## Security Categories (OWASP Top 10)

### API Focus
- **A01**: Access Control (auth/authz)
- **A02**: Cryptographic Failures (encryption, secrets)
- **A03**: Injection (SQL, MQTT, command injection)
- **A04**: Insecure Design (rate limits, timeouts)
- **A05**: Misconfiguration (debug endpoints, CORS)
- **A06**: Vulnerable Components (dependency versions)
- **A07**: Auth & Session Management (tokens, expiration)
- **A08**: Data Integrity Failures (CI/CD security)
- **A09**: Logging Failures (security event logging)
- **A10**: SSRF (URL validation for external calls)

### UI Focus
- **XSS Prevention**: DOM escaping, CSP headers
- **CORS**: Proper `Access-Control-Allow-Origin` scoping
- **Storage**: Secure token/credential handling
- **Headers**: Security headers (CSP, X-Frame-Options)
- **Components**: Keep npm packages up-to-date

---

## CI/CD Workflow

```
Push PR
  ↓
CI runs:
  • dotnet build
  • dotnet test (21 tests)
  • Coverage collection (Cobertura XML)
  • Coverage enforcement (≥50% Phase 1)
  • Codecov upload (optional)
  ↓
  Pass: Green check ✓
  Fail: Red X ✗ (shows coverage %)
  ↓
Request code review
  ↓
If security-sensitive: Request @security-reviewer
  ↓
Address feedback
  ↓
Merge to main
```

---

## Dependabot

**What it does**:
- Scans NuGet packages weekly for vulnerabilities
- Scans npm packages in `tests/` for vulnerabilities
- Opens PRs with security updates and patch recommendations

**What you do**:
1. Review the PR
2. CI will run tests (same as normal PR)
3. If tests pass, approve and merge
4. Dependabot handles auto-merge (if configured)

**Check status**:
- GitHub repo → Security → Dependabot alerts
- Or `git pull` to see Dependabot PRs locally

---

## Codecov (Optional Dashboard)

**Setup** (one-time, 10 min):
1. Visit https://codecov.io
2. Sign in with GitHub
3. Add your repository
4. Copy token from Settings
5. Add to GitHub: Settings → Secrets → `CODECOV_TOKEN`

**Benefits**:
- Coverage dashboard over time
- PR comments showing coverage impact
- Per-file coverage reports
- Historical trends

**Not required for CI to pass** — coverage is checked locally in CI workflow

---

## Troubleshooting

### "Coverage enforcement failed: 45% < 50%"
→ Add tests for new code paths, or PR is reducing coverage
→ Check `docs/quality-and-security.md` for guidance

### "Security-reviewer not found"
→ Agent is in `.github/agents/security-reviewer.agent.md`
→ Make sure you're requesting it correctly: `@security-reviewer Please review...`

### "CI passed but I expected coverage check"
→ Coverage check is in `.github/workflows/ci.yml`
→ Local `dotnet test --collect:"XPlat Code Coverage"` will show it
→ GitHub shows result in "Enforce code coverage >= 50%" step

### "Dependabot not opening PRs"
→ Wait 24 hours after push
→ Check GitHub Settings → Security → Dependabot alerts
→ `.github/dependabot.yml` is correctly configured

---

## Resources

| Resource | Link | Purpose |
|----------|------|---------|
| **Quick Start** | `docs/contributor-guide.md` | Developer workflow (5 min read) |
| **Full Guide** | `docs/quality-and-security.md` | Implementation details (10 min read) |
| **GitHub Setup** | `docs/branch-protection.md` | Branch protection config (5 min) |
| **Security Review** | `.github/agents/security-reviewer.agent.md` | OWASP checklist details |
| **This Card** | `Quick Reference Card` (this file) | At-a-glance reference |
| **Summary** | `IMPLEMENTATION_SUMMARY.md` | Complete implementation details |

---

## Key Contacts

For questions about:
- **Code coverage**: See `docs/quality-and-security.md` Phase section
- **Security review**: See `.github/agents/security-reviewer.agent.md`
- **Dependabot**: See GitHub Security → Dependabot alerts tab
- **GitHub branch protection**: See `docs/branch-protection.md`
- **General workflow**: See `docs/contributor-guide.md`

---

**Last Updated**: 2024
**Status**: Active (Phase 1 of 4)
**Next Phase**: Phase 2 (60% threshold) in ~1 month
