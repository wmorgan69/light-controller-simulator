# Building Light Controller Simulation — Project Plan

## Goal

Create a .NET solution that simulates a four-story building's lighting controllers, presents an interactive 3D view, and provides separate instrumentation that reads controller telemetry and reports status and faults.

## Solution layout

```text
devices/
  Devices.slnx
  src/
    Devices.Contracts/
    Devices.Simulator.Web/
    Devices.Instrumentation.Web/
  tests/
    Devices.Simulator.Tests/
    Devices.Instrumentation.Tests/
  docs/
    README.md
    plans/
      plan.md
      building-editor-spec.md
    technical/
      building-light-simulator.md
      lighting-instrumentation.md
```

## Building model

- The initial design has four floors, with one logical controller assigned to each floor. The local editor can save 1–10 floors.
- Floor 1 has Open Workspace, Reception Office and Support Office; Floor 2 has Boardroom and Meeting Office; Floor 3 has Collaboration Space, Project Office and Focus Office; Floor 4 has The Forum.
- Main rooms have 6 strips on Floors 1 and 3, 8 on Floor 2, and 12 on Floor 4, arranged in two rows; each office has one strip.
- Each room has one presence sensor.
- The simulator UI defaults to Floor 3 and its Collaboration Space in the baseline design.

## Architecture and communication

- ASP.NET Core provides both web applications.
- `Devices.Contracts` supplies shared controller, room, sensor, light, fault, telemetry, command, and acknowledgement records.
- The simulator publishes retained MQTT state and accepts MQTT commands.
- The instrumentation application polls the simulator HTTP API and can also consume MQTT telemetry; both inputs feed the same telemetry store.
- Separate SQLite databases store simulator designs and instrumentation controller state and recent events.
- Instrumentation polls the active design's revisioned controller snapshot to reconcile removals; MQTT cleanup is asynchronous.
- HTTP mutation responses return current authoritative controller state.

![Architecture: the simulator maintains authoritative state, which reaches the instrumentation dashboard through HTTP polling and optional MQTT telemetry.](../assets/diagrams/plan-architecture.svg)

## Delivery phases

1. **Foundation:** create the solution, contracts, stable IDs, configuration, and focused tests.
2. **Simulation:** implement controllers, rooms, sensors, light strips, faults, and HTTP mutations.
3. **3D simulator UI:** render the building and provide floor, room, sensor, fault, scenario, and camera controls.
4. **Telemetry:** publish retained MQTT state and command acknowledgements.
5. **Instrumentation:** ingest MQTT and HTTP-polled telemetry, persist state, and render the latest view.
6. **Hardening:** add revisioning, stale/offline detection, replay protection, and broker status.

## Acceptance criteria

- The initial design's four controllers, 9 rooms, 9 sensors, and 37 light strips have stable IDs.
- Sensor mutations change only the selected room and publish observable state.
- Fault injection and clearing recompute controller and room state correctly.
- Instrumentation remains useful with or without MQTT.
- The baseline 3D view starts with Floor 3 selected and its Collaboration Space open.
- The UI provides a complete non-3D control path.
- English room names and UI text are maintained as localization resources; language selection and other translations are not implemented.
- Changes include focused tests and accurate documentation.

## Implementation decisions

1. **Lights-off behavior:** sensor trigger turns on the room; reset clears presence, triggered state, and lights.
2. **Fault scope:** sensor, light-strip, and controller fault targets are supported.
3. **MQTT:** an external broker is configurable; HTTP polling remains active and supports operation without a broker.
4. **3D:** Three.js is bundled locally for the building visualization.
5. **Persistence:** Separate SQLite stores hold simulator designs and instrumentation latest state and events.
6. **Startup:** The baseline selects Floor 3 and Collaboration Space; edited designs need not contain them.
7. **Occupancy demo:** 1–2 random rooms are occupied per floor, up to the number available.

## Building editor and remaining work

- The [building editor](building-editor-spec.md) is implemented for loopback-only Development hosts, with local unsaved edits, revision-checked saves, validation, activation and cleanup. Editing UX fixes and verification are in progress.
- Edited-design 3D views include illustrative perimeter walkways, exterior stairs, landings and pillars outside the editable footprint; they do not guarantee routes from interior doors.
- Protected editor access for non-loopback, proxy and Compose deployments, automatic backups and periodic activation retry remain unimplemented.
- Decide whether to add inactivity timers.
- Decide whether to retain historical utilization charts.
- The optional broker-backed MQTT integration test requires Docker and a cached Mosquitto image; provisioning it in CI and covering disconnects and restarts remain open.
- Decide whether to add authentication and TLS for broker deployments.

## Agent workflow

Feature work follows:

1. Plan and inspect existing behavior.
2. Implement and add focused tests.
3. Build and test.
4. Run independent code review.
5. Run UX review for user-visible UI changes.
6. Fix findings and repeat affected validation/review.
7. Confirm documentation and run/test evidence.

Repository instructions live in [AGENTS.md](../../AGENTS.md). Agent profiles live under [.github/agents](../../.github/agents/).

## Documentation

- [Documentation home](../README.md)
- [Building Light Simulator](../technical/building-light-simulator.md)
- [Lighting Instrumentation](../technical/lighting-instrumentation.md)
