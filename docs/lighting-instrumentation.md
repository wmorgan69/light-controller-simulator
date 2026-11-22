# Lighting Instrumentation

## Table of contents

- [Purpose](#purpose)
- [Design](#design)
- [Telemetry architecture](#telemetry-architecture)
- [Dashboard information hierarchy](#dashboard-information-hierarchy)
- [State and offline semantics](#state-and-offline-semantics)
- [MQTT and HTTP inputs](#mqtt-and-http-inputs)
- [Persistence](#persistence)
- [API](#api)
- [Source tree](#source-tree)
- [Configuration](#configuration)
- [Running and testing](#running-and-testing)

## Purpose

The instrumentation application presents the latest building state and recent device events. It is a telemetry consumer: it should not depend on in-process simulator internals.

## Design

![Design: MQTT and HTTP fallback feed the telemetry store, which provides dashboard summaries, lighting activity, floor cards, recent events, and SQLite persistence. Controller states and device events also feed their respective dashboard views.](assets/diagrams/lighting-instrumentation-design.svg)

The UI prioritizes building-wide health and lighting activity, then floor details, then recent events.

## Telemetry architecture

![Telemetry architecture: MQTT broker messages reach the telemetry store through the subscriber. HTTP fallback polls the simulator and ingests changed states. The dashboard requests telemetry and events from the store.](assets/diagrams/lighting-instrumentation-telemetry.svg)

MQTT is preferred, while the HTTP fallback keeps the dashboard usable when no broker is running.

## Dashboard information hierarchy

1. Connection/transport status
2. Controllers online
3. Active faults
4. Lights on
5. Occupied rooms
6. Aggregate on/off/fault fixture activity
7. Floor and room details
8. Recent events

Status is conveyed with text and color. The dashboard does not infer unsupported energy, cost, or historical utilization metrics.

## State and offline semantics

![State transitions: an observed controller is healthy with no faults, faulted with an active fault, or offline after the stale observation timeout. New telemetry returns an offline controller to observed.](assets/diagrams/lighting-instrumentation-state.svg)

- A controller is online unless its status is `Offline`.
- `Faulted` controllers remain online.
- Fixtures count as on only if `IsOn` is true and `IsFaulted` is false.
- Faulted fixtures are shown separately from off fixtures.
- `Telemetry:StaleAfterSeconds` controls when an unobserved controller becomes offline.
- Older revisioned telemetry does not replace a newer state in the store.

## MQTT and HTTP inputs

The subscriber listens to:

```text
building/controllers/+/telemetry
```

The HTTP fallback polls:

```text
GET http://localhost:5080/api/controllers
```

The refresh loop only publishes changed HTTP states as events and uses the same `TelemetryStore` as MQTT ingestion.

## Persistence

SQLite stores:

- `telemetry_events` - recent event history
- `controller_latest` - last controller state
- `controller_observed` - last successful observation timestamp

The in-memory store keeps the latest controller snapshot and at most 500 recent events.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/telemetry` | Latest controller states |
| `GET` | `/api/telemetry/{controllerId}` | One controller state |
| `GET` | `/api/events` | Recent telemetry events |
| `GET` | `/api/status` | MQTT and HTTP transport status |

## Source tree

```text
src/Devices.Instrumentation.Web/
  Devices.Instrumentation.Web.csproj
  Program.cs
  appsettings.json
  Properties/launchSettings.json
  wwwroot/
    app.js       polling, formatting, live dashboard rendering
    index.html   dashboard structure
    styles.css   summary cards, controller cards, event feed
```

Shared contracts are in [Devices.Contracts](../src/Devices.Contracts/).

## Configuration

```json
{
  "Mqtt": {
    "Host": "localhost",
    "Port": 1883
  },
  "Telemetry": {
    "SqlitePath": "telemetry.db",
    "SimulatorBaseUrl": "http://localhost:5080",
    "StaleAfterSeconds": 30
  },
  "Urls": "http://localhost:5081"
}
```

Relative `Telemetry:SqlitePath` values are resolved against the instrumentation web project's content root. The default database is therefore `src/Devices.Instrumentation.Web/telemetry.db`, regardless of the process working directory.

## Running and testing

```powershell
dotnet run --project src/Devices.Instrumentation.Web/Devices.Instrumentation.Web.csproj --urls http://localhost:5081
dotnet test tests/Devices.Instrumentation.Tests/Devices.Instrumentation.Tests.csproj
```
