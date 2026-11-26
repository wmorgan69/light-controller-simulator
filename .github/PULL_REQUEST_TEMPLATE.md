## Summary

<!-- What changed and why? -->

## Validation

- [ ] Relevant tests pass, or not applicable with a reason for documentation/instruction-only changes.
- [ ] `dotnet build Devices.slnx` passes for executable changes; otherwise local build is not applicable with a reason.
- [ ] `dotnet test Devices.slnx --no-build --no-restore` passes after a current build for executable changes; otherwise local tests are not applicable with a reason.
- [ ] Applicable coverage evidence recorded; CI enforces >= 50% on the first .NET report, not combined solution coverage (90% is a proposed target).

<!-- Record each exact command and result/counts, reviewed revision/scope, and missing checks. Reuse current evidence. Documentation-only local exemptions do not bypass required full PR CI. -->

## Security & Dependencies

<!-- Security review applies to external inputs, APIs, authentication/authorization, sensitive data, security controls, dependencies, and security workflows. Record the review once under Independent reviews; otherwise give a not-applicable reason. -->
- [ ] Dependabot alerts addressed (if any).
- [ ] No secrets, credentials, or sensitive data committed.
- [ ] New external inputs are validated and sanitized.
- [ ] Authentication/authorization checks are present where required.

## Independent reviews

- [ ] Code review completed after implementation; findings fixed or explicitly documented.
- [ ] Security review completed when applicable; findings fixed/documented, or not applicable with a reason.
- [ ] UX review completed for user-visible UI changes or documentation describing changed UI behavior; findings fixed/documented, or not applicable with a reason.
- [ ] Affected reviews repeated on incremental fixes and impacted dependencies after review-driven changes, or no such changes.
- [ ] Documentation was updated for changed behavior, APIs, configuration, source layout, or UI.
- [ ] Code review confirmed documentation links, Mermaid diagrams, defaults, run/test commands, and source references are accurate.

## UX evidence (UI changes)

<!-- Note desktop/mobile sizes and important states checked, or explain what could not be verified. -->
<!-- Identify the evidence owner and revision; share current captures/results rather than duplicating browser setup. -->

