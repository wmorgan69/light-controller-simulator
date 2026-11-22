# Building Light Simulator

A .NET IoT demonstration for a four-floor office building. The solution combines an interactive 3D lighting simulator with a separate telemetry and instrumentation dashboard.

## Agentic workflow

This repository uses an agentic build-review-rebuild workflow with staged changes and pull request review:

![Agentic workflow diagram showing Plan, Implement, Build, Code Review, Security Review if needed, UX Review if needed, and Merge](docs/assets/diagrams/agentic-workflow.svg)

**Workflow process:**
1. Agent plans, implements, builds, and validates changes
2. Changes are staged (not auto-committed) and grouped by scope
3. Pull request is created with implementation, build validation, and test results
4. Required reviewers (code, security if applicable, UX if applicable) independently evaluate the PR
5. Human approves, requests changes, or merges when ready
6. Repository rules, when configured, enforce required checks and approvals before merge

Agent customization:

- [AGENTS.md](AGENTS.md) defines repository-wide clean-code, testing, documentation, review, and merge requirements.
- [Build/review/rebuild agent](.github/agents/build-review-rebuild.agent.md) coordinates implementation and validation.
- [Code reviewer](.github/agents/code-reviewer.agent.md) independently checks correctness, clean code, tests, documentation accuracy, and **code coverage impact** (new code is tested; overall coverage is not regressing below phase threshold).
- [Security reviewer](.github/agents/security-reviewer.agent.md) independently checks for OWASP Top 10 UI and API vulnerabilities (required for PRs that add external inputs, API endpoints, or authentication/authorization logic).
- [UX reviewer](.github/agents/ux-reviewer.agent.md) independently checks UI clarity, accessibility, responsive behavior, and state rendering.
- [Pull-request template](.github/PULL_REQUEST_TEMPLATE.md) records validation and reviewer evidence.
- [CI workflow](.github/workflows/ci.yml) builds and tests pull requests, checks the first collected coverage report against a 50% threshold, and runs Node.js and Docker Compose checks.

**Branch protection:** The intended workflow uses pull requests, CI, and human review. Enforcement depends on the repository's branch protection or rulesets; the workflow and agent instructions alone do not enforce approvals or prevent direct pushes.

## Overview

The project demonstrates:

- Device-style controller, room, sensor, light, fault, telemetry, and command state.
- HTTP APIs for inspecting and changing simulator state.
- Optional MQTT state publication, command handling, acknowledgements, retained state, and reconnect behavior.
- HTTP fallback telemetry for use without an MQTT broker.
- An interactive Three.js building with floor selection and room-level controls.
- Live controller health, occupancy, lighting activity, faults, events, and SQLite persistence.
- Unit-tested state transitions, revision handling, stale/offline behavior, and event persistence.

![System architecture: browser users access the simulator and dashboard; HTTP fallback and optional MQTT telemetry flow into the telemetry store and SQLite.](docs/assets/diagrams/architecture.svg)

Simulator state reaches the instrumentation telemetry store through HTTP polling or an optional MQTT broker; the store persists data in SQLite.

## Applications

| Application | URL | Purpose |
|---|---|---|
| Building Light Simulator | `http://localhost:5080/` | 3D building view, room controls, faults, scenarios, and device state |
| Lighting Instrumentation | `http://localhost:5081/` | Controller health, occupancy, lighting activity, faults, and events |

## Screenshots and demo

The screenshots show the simulator and instrumentation dashboard. The video shows all floors with camera pan and rotation, then floor selection, zooming and room selection, followed by presence and sensor-fault changes, live instrumentation updates, and the occupancy demo.

### Building Light Simulator

![Building Light Simulator showing floor navigation, a selected floor, and room controls](docs/assets/screenshots/building-light-simulator.png)

![Building Light Simulator showing Floor 2, the selected Office A, room controls, and illustrative wiring](docs/assets/screenshots/building-light-simulator-selected-floor.png)

### Lighting Instrumentation

![Lighting Instrumentation showing building status, lighting activity, controllers, and recent events](docs/assets/screenshots/lighting-instrumentation.png)

[Watch the building lighting demo on GitHub Pages](https://wmorgan69.github.io/light-controller-simulator/demo.html)

## Quick start

Run the simulator:

```powershell
dotnet run --project src/Devices.Simulator.Web/Devices.Simulator.Web.csproj --urls http://localhost:5080
```

Run the instrumentation dashboard:

```powershell
dotnet run --project src/Devices.Instrumentation.Web/Devices.Instrumentation.Web.csproj --urls http://localhost:5081
```

The default simulator startup view selects Floor 3 and its Main Room. MQTT is optional; the dashboard polls the simulator over HTTP when no broker is available.

### Docker Compose

With Docker and Docker Compose available, start both applications from the repository root:

```powershell
docker compose up --build
```

Open `http://localhost:5080/` for the simulator and `http://localhost:5081/` for the dashboard. The dashboard polls `http://simulator:8080` over the Compose network; no MQTT broker is required. Its SQLite database is stored in the `telemetry-data` named volume and persists when the containers are stopped or recreated. Stop the applications with `docker compose down`.

In CodeSandbox, this requires a server environment with a working Docker engine and Compose; forward ports 5080 and 5081 to access the applications.

## Documentation

- [Documentation home](docs/README.md)
- [Project plan](docs/plan.md)
- [Building Light Simulator](docs/building-light-simulator.md)
- [Lighting Instrumentation](docs/lighting-instrumentation.md)

## Source layout

```text
Dockerfile                       Container build stages for both applications
compose.yaml                     Local two-service deployment
.dockerignore                    Container build exclusions
src/
  Devices.Contracts/             Shared device and telemetry contracts
  Devices.Simulator.Web/         Simulator API and 3D browser UI
  Devices.Instrumentation.Web/   Telemetry subscriber and dashboard
tests/
  Devices.Simulator.Tests/       Simulator state-transition tests
  Devices.Instrumentation.Tests/ Telemetry store tests
docs/                            Project and application documentation
  assets/                        Diagrams, screenshots, videos, and recording helper
.github/                         CI, agents, and pull-request workflow
AGENTS.md                        Repository-wide agent instructions
```

## Build and test

```powershell
dotnet build Devices.slnx
dotnet test Devices.slnx --no-build --no-restore
```
