---
applyTo: "src/**,tests/**,docs/assets/*.mjs,package.json,package-lock.json,*.config.js,tsconfig.json,Devices.slnx,Dockerfile,compose.yaml,.github/workflows/**"
---

# Testing and validation rules

- Add/update focused tests for every introduced or changed executable behavior. Test observable behavior and transitions, not constants, trivial accessors, or framework behavior.
- Before fixing a bug, identify/add a regression test that reproduces it. Cover meaningful normal, boundary, invalid-input, and failure cases; avoid coverage-only tests.
- Keep tests deterministic and isolated: no timing sleeps, real brokers/services, external network, wall-clock assumptions, or machine-specific paths. Use current frameworks/helpers; prefer existing xUnit patterns for .NET.
- For browser-only issues not covered by current infrastructure, record browser verification and test any newly testable lower-level behavior.
- Run the smallest relevant selectors while iterating. Before completing executable changes, run `dotnet build Devices.slnx` and `dotnet test Devices.slnx --no-build --no-restore` after a successful current build. Apply existing frontend lint, type-check, build, and tests where affected.
- For simulator view logic/recording helpers, run from the root: `node --import tsx --test tests/building-access.test.mjs tests/wiring-routes.test.mjs tests/floor-view.test.mjs tests/room-state.test.mjs tests/record-demo.test.mjs`. The `tsx` loader is needed for current TypeScript imports.
- Share exact commands, revision/scope, pass/fail counts, and failures. Reuse current evidence; rerun affected checks after fixes and broader checks when dependencies or earlier evidence are invalidated.
- Documentation/instruction-only changes need link/configuration/diagram checks and applicable independent review, not application builds or coverage collection. Full PR CI remains required and unchanged.
- For executable changes, review focused tests and available coverage evidence. CI currently enforces >=50% on the first discovered .NET report, not combined solution coverage or absence of regression. Do not claim aggregate/non-regression evidence from that gate alone.
- Reuse applicable CI/Codecov/local reports; request missing evidence only for the affected runtime. Frontend V8 coverage (`npm run test:components:coverage`) is separate from .NET coverage. Do not request .NET coverage for a frontend-only or documentation-only change.
- Document justified C# exclusions and verify them against Coverlet; JavaScript/3D rendering is not measured by .NET coverage.
