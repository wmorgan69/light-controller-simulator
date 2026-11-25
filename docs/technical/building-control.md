# Building Control

## Table of contents

- [Purpose](#purpose)
- [Design](#design)
- [Building model](#building-model)
- [Runtime architecture](#runtime-architecture)
- [User interactions](#user-interactions)
- [HTTP API](#http-api)
- [Building editor](#building-editor)
- [MQTT protocol](#mqtt-protocol)
- [Persistence and backup](#persistence-and-backup)
- [Source tree](#source-tree)
- [Configuration](#configuration)
- [Running and testing](#running-and-testing)

## Purpose

Building Control starts with a four-floor office building and provides simulated device state that can be changed through HTTP or MQTT. A local editor can save a different building design. The heading identifies the application, with **Connection: Simulated** underneath; this identifies the configured connector, not its health or MQTT transport status. It uses an in-process simulator connector; it does not connect to physical devices. It remains intended for local use, IoT protocol experiments, and testing the separate instrumentation dashboard.

## Design

The application separates:

- **Device state** - controllers, rooms, sensors, light strips, presence, faults, and revisions.
- **HTTP control** - browser-visible commands and state inspection.
- **MQTT telemetry** - retained state snapshots and command acknowledgements.
- **3D presentation** - local Three.js scene with floor and room selection.

The [building editor technical guide](building-editor.md) covers operation and implementation; the [specification](../plans/building-editor-spec.md) describes the design and remaining gaps.

![Design flow: the browser UI calls HTTP endpoints, which use connector contracts to access simulated device state; state is returned over HTTP and published through optional MQTT to the instrumentation subscriber.](../assets/diagrams/building-control-design.svg)

## Building model

![Building model: the building has four floors; Floor 1 contains a controller, Open Workspace with six strips, and Reception Office and Support Office with one strip each.](../assets/diagrams/building-control-model.svg)

The initial, seeded design has one controller and one sensor per room:

- 4 controllers
- 9 rooms and 9 presence sensors
- 37 light strips
- Floor 1: Open Workspace with 6 strips in two rows of three; Reception Office and Support Office with one strip each
- Floor 2: Boardroom with 8 strips in two rows of four; Meeting Office with one strip
- Floor 3: Collaboration Space with 6 strips in two rows of three; Project Office and Focus Office with one strip each
- Floor 4: The Forum with 12 strips in two rows of six

![Floor layouts and named rooms on all four floors, with their light-strip counts.](../assets/diagrams/building-control-floors.svg)

Stable IDs are created in [Ids.cs](../../src/Devices.Contracts/Ids.cs):

- Controller: `controller-floor-{n}`
- Room: `floor-{n}-{room}`
- Sensor: `sensor-floor-{n}-{room}`
- Light: `light-floor-{n}-{room}-{index}`

The seed preserves these existing IDs, names and strips. Room state carries an explicit `sensorId`; older state without it uses the legacy ID derived from floor and room key. Edited designs can use other stable IDs. IDs removed from a saved design are retired and cannot be reused. Runtime presence, faults and lights are in memory, not persisted across simulator restart.

Room names are display names in HTTP and MQTT state; seeded IDs retain their existing `main`, `office-a` and `office-b` keys. Stored telemetry history may show previous names.
The model's English room names are embedded from [RoomNames.resx](../../src/Devices.Contracts/RoomNames.resx). They are independent of the server's UI culture so the shared HTTP and MQTT state remains consistent.

## Runtime architecture

![Runtime architecture: browser commands update the simulator through HTTP, which returns revised controller state. State publication is queued for MQTT and reaches the instrumentation subscriber through the broker.](../assets/diagrams/building-control-runtime.svg)

![Connector boundary: Building Control reads and activates designs through the building device connector contract, uses simulation controls through the simulated connector contract, and resolves both to the same in-process simulator connector.](../assets/diagrams/simulated-device-connector.svg)

The web project depends on `IBuildingDeviceConnector` for reads and design activation, and on `ISimulatedDeviceConnector` for simulated sensor, fault, scenario and MQTT commands. Dependency injection resolves both interfaces to one `BuildingSimulator` in the separate `Devices.Connectors.Simulation` project, so reads, activation, mutations and MQTT share the same state. The [connector guide](simulated-device-connector.md) describes the boundary and its limitations. The simulator-specific operations are not a physical-device contract; real connectors, production identity, durable device state and cloud IoT integration remain unimplemented.

## User interactions

The Building list sits beside the 3D view on desktop; on narrow screens, **Open building navigation** opens a drawer with the same floor and scenario controls. Selecting a floor closes the drawer. It shows each floor's controller status, occupied-room count, and the current selection, with scenario controls below the floors. An icon marks faulted controllers, and the occupancy count reflects room presence. The controller view refreshes every five seconds as well as after local mutations.
On narrow screens the camera widens its view to keep the floor visible; on wider screens the selected-floor view is slightly farther out. The preset updates across the breakpoint unless the camera has been moved manually.

![Navigation flow: the Building floor list selects either a floor and its main room or the full building overview. Selecting a floor in the overview opens that floor; selecting a room opens its controls.](../assets/diagrams/building-control-navigation.svg)

- **Floor selection** displays only the chosen floor in the 3D view, opens its main room where present (otherwise the first room), and moves the camera to that floor. Selecting the same floor again resets its camera without changing the selected room. The Building list and live status table retain the other floors' status.
- **Startup** selects Floor 3's Collaboration Space and uses the selected-floor camera for the baseline design; an edited design may not have that floor or room.
- **All floors** clears the floor selection, restores detailed floors and normal spacing, and restores the complete-building camera.
- **Building geometry** uses the active design's dimensions, rooms, doors, fixtures and controllers at every revision. A fresh database uses the four-floor 10 × 8 m layout; its room geometry approximates the original scene on the grid. Existing designs retain their saved dimensions and coordinates, so older 20 × 20 m designs display that footprint rather than the old fixed 10 × 8 m slab.
- **Architecture and access** include illustrative pillars, stairs, landings and walkways. Legacy null or absent access arrays are generated relative to the design footprint in memory; empty arrays remove the corresponding objects. Floor slabs, landings, walkways, floor labels, room walls and doors select their associated floor or room. The scene remains illustrative and does not guarantee routes from interior doors.
- **Sensors** normally sit just below the illustrative ceiling at the end of their wiring connection. Sensor routes use separate offsets from light routes and each other; office sensors are also positioned apart from the light strips. When edited rooms share a sensor position, the 3D view separates the markers toward their room interiors and raises them above the ceiling and lights without changing the saved positions. Sensors without presence or a fault are white, sensors detecting presence are green, and faulted sensors are red and pulse even when their room is not selected; with reduced motion enabled they remain steadily red. A faulted sensor's route is red and dashed instead of blue, indicating the sensor fault rather than a faulty wire. Selected rooms have light outlines rather than sensor-wire-colored walls. A sensor fault does not turn the room's walls or floor red; active fault rows identify their targets in text.
- **Room illumination** warms its floor and walls in proportion to its working lights and shows soft, illustrative rays widening downward from each working strip toward the floor. These effects and the live-status light counts exclude faulted strips, rather than assuming presence always means lights are on; the effects are not ray tracing.
- **Room selection** is available by clicking or tapping a room in the 3D view, as indicated in the view's interaction help.
- **Wiring** automatically connects the selected floor's controller to its sensors and light strips in an illustrative overlay. Sensor routes are offset from light routes to keep them distinct. No wiring is shown in All floors view. A key in the 3D view identifies blue wiring as sensors and yellow wiring as lights; the routes are not actual cable layouts.
- **Room inspector** controls presence and sensor-fault state for the selected room only. A floor remains faulted while any fault on its controller remains active.
- **Reset building** clears presence, triggered state, lights, and faults.
- **Occupancy demo** randomly selects 1–2 rooms per floor, capped at the number of rooms on that floor, and turns on their current strips. Scenario controls are disabled and announce progress while a scenario is running. The UI applies the resulting controller snapshot returned by the mutation endpoint.
- **Accessible controls** and the keyboard-accessible Building list provide floor selection, selected-room trigger and reset actions, and fault injection and clearing without 3D hit testing. Choosing All floors restores the overview.
- **Refresh status** reports when a controller refresh fails while retaining the last successful controller snapshot; a transport-status failure is reported separately and does not prevent the building view from loading.
- **Building status** summarizes activation and flags pending or failed controller cleanup. Expand its details for saved and running revisions and cleanup counts; these counts describe controller cleanup, not unsaved editor changes.
- **3D view failure** reports renderer or scene errors and offers a retry. The live status panel's accessible controls remain available for floor selection, sensor actions, and fault management when WebGL is unavailable.

The browser UI is a strict TypeScript React application using Material UI. `frontend/main.tsx` mounts the app; `SimulatorApp.tsx` owns page state and controls, `BuildingEditor.tsx` implements the editor interface, and `SceneCanvas.tsx` owns the Three.js renderer and disposes its resources on unmount. The editor, access, localization, view-model, geometry and scene helpers are TypeScript modules under `frontend/`. The renderer, OrbitControls and geometry helpers use the same locally bundled Three.js package, without a CDN. `wwwroot/index.html` loads `/dist/app.js` and `/dist/app.css`, generated by the root Vite build. The [frontend build and test commands](../README.md#frontend-build-and-tests) cover local setup; Docker runs the same build before .NET publish.

Build the React bundle rather than loading TypeScript source files directly.

Before the app mounts, the page displays an initialization message with reload guidance; a separate message explains that JavaScript is required when scripting is disabled.

Browser interface text is in [localization.en.ts](../../src/Devices.BuildingControl.Web/frontend/shared/localization.en.ts). React components use these resources directly; the HTML title retains an English fallback. Only English is provided; there is no language selector or automatic culture negotiation.

![Access flow: a room connects through an open doorway and rear walkway to a stair landing and the adjacent floor.](../assets/diagrams/building-control-access.svg)

## HTTP API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/controllers` | List controller states |
| `GET` | `/api/controller-snapshot` | Authoritative active design revision and controller membership |
| `GET` | `/api/building-view` | Active design and current controllers, returned together |
| `GET` | `/api/building-design-status` | Saved and running revisions, activation status, and cleanup counts |
| `GET` | `/api/capabilities` | Non-cached `mutationsAllowed` and `editorAllowed` flags for this request |
| `GET` | `/api/controllers/{controllerId}` | Get one controller |
| `GET` | `/api/status` | MQTT and HTTP transport status |
| `POST` | `/api/rooms/{roomId}/sensor/trigger` | Trigger a room sensor |
| `POST` | `/api/rooms/{roomId}/sensor/reset` | Reset presence and room lights |
| `POST` | `/api/devices/{deviceId}/faults` | Add sensor, strip, or controller fault |
| `DELETE` | `/api/devices/{deviceId}/faults/{faultId}` | Clear a fault |
| `POST` | `/api/scenarios/reset` | Reset the full building |
| `POST` | `/api/scenarios/occupancy` | Randomize 1–2 occupied rooms per floor, up to the number available |

The snapshot is `{ "revision": number, "controllers": [...] }`. Instrumentation polls it, rejects stale revisions or changed membership at the same revision, persists removed-controller tombstones, and retains event history. Only a `404` falls back to the legacy `/api/controllers` list. See [instrumentation persistence](building-instrumentation.md#persistence).

The read-only design status returns `savedRevision`, `runningRevision`, `activationStatus`, `pendingCleanup`, `failedCleanup`, and `completedCleanup`. The simulator header polls it every five seconds after each response and shows an unavailable state if the request fails. When the running revision changes, the simulator refreshes its building view and controls; a failed refresh is reported and retried on the next poll. This endpoint remains available when editor access is disabled.

The [manual HTTP examples](../../src/Devices.BuildingControl.Web/Editor/BuildingEditor.http) exercise these endpoints and the editor API. **The save example replaces design data**; use an isolated simulator database.

## Building editor

The editor offers an SVG plan and forms for building dimensions, floors, rooms, doors, controllers, sensors, lights and logical connections. Unsaved edits stay in the open browser session; the editor provides session undo/redo and JSON export, and can save, retry work or leave. Leaving with unsaved edits prompts for confirmation. A revision conflict stops writes; local edits can be exported or the current server state adopted.

The toolbar's right-aligned desktop **Building menu** contains **Edit building**; on narrow screens its overflow trigger is named **Open building menu** and remains opposite the navigation hamburger. The item is disabled until server-backed editor access is confirmed, with an access explanation next to the trigger and in the menu. Floor and scenario controls remain available through the navigation drawer on narrow screens. Opening the editor closes the menu and moves keyboard focus to its heading. Escape closes the menu, and returning from the editor moves focus to the menu trigger even if access became unavailable.

Editor endpoints are available **only** in the Development environment on a directly connected loopback server and client. Every configured listening address and the request host must be loopback; the request scheme and port must match a listener. Forwarding headers are rejected. Mutations require a same-origin `Origin`; GET/HEAD may omit it. No authentication is provided. Non-loopback listeners, proxies, and the supplied Compose deployment cannot use the editor.

**Deployment warning:** other simulator API mutations reject forwarding headers, non-loopback Host values, cross-origin or malformed `Origin` headers, and `Sec-Fetch-Site` values other than `same-origin`. Originless command-line requests are allowed. These checks do not authenticate callers or verify the TCP peer; they rely on loopback-bound deployment. `Simulator:AllowHttpMutations` defaults to `true`; Compose sets it to `false`, disabling HTTP simulator controls as well as editor access while retaining read-only viewing and telemetry. This also blocks mutations from Compose-network peers. The browser checks `/api/capabilities` periodically, reports view-only or unavailable access, and disables mutation controls until access is confirmed. These UI flags are not authorization; the server checks every mutation. MQTT commands are separate and require a trusted broker with its own access controls. Compose publishes both application ports on `127.0.0.1`; instrumentation APIs remain unauthenticated. Do not expose these services through proxies or non-loopback bindings. Local users and processes share access.

| Method | Editor endpoint | Request / result |
|---|---|---|
| `GET` | `/api/building-editor` | Saved `design`, `activeDesign`, `editRevision`, `activationStatus`, and `cleanup` |
| `POST` | `/api/building-editor/save` | `{ "expectedRevision": n, "design": {...} }`; saves, attempts activation, returns state |
| `POST` | `/api/building-editor/retry` | Retries activation |
| `POST` | `/api/building-editor/retry-cleanup` | Requests cleanup retry, returns `202` |

JSON uses camelCase. Successful state responses include saved and active revisions separately. Save compares the client-observed `editRevision`; stale revisions return `409`. Invalid designs return `400` with `detail` and field-path `errors`. Access failures return `403`. Save can return success with `activationStatus` `failed` or `pending`; a saved design is not necessarily running. The editor refreshes status every 20 seconds. See the [editor specification](../plans/building-editor-spec.md#building-design-and-validation) for payload and geometry rules.

## MQTT protocol

The publisher uses `building/controllers/{controllerId}/telemetry` for retained state telemetry.
Commands are received on `building/controllers/{controllerId}/commands`; validly routed commands that are accepted or rejected return a non-retained acknowledgement on `building/controllers/{controllerId}/commands/{commandId}/ack`.

![MQTT command flow: DeviceCommand reaches the command handler via the controller commands topic. The resulting state mutation produces an acknowledgement and controller telemetry.](../assets/diagrams/building-control-mqtt.svg)

Supported actions:

- `trigger`
- `reset`
- `add-fault`
- `clear-fault`

The command contract includes stable command, controller, room, target, scope, description, and timestamp fields. The topic must have exactly the stated four levels, and its controller ID must match the payload controller ID. Controller and command IDs must be nonblank, at most 128 characters, and each must fit one MQTT topic level without `+`, `#`, `/` or control characters. Malformed or mismatched topics and invalid IDs are rejected without publishing an acknowledgement. Once routing is valid, an invalid target or other command rejection produces a negative acknowledgement. Command IDs and timestamps are not tracked for replay protection, so repeated valid commands are processed independently. MQTT routing validation is not publisher authentication; broker access controls remain necessary.

After activation removes a controller, a persistent cleanup item causes an empty retained payload to be published to its telemetry topic. Pending and failed work is retried while MQTT is connected, normally every five seconds, and is revision-fenced. HTTP mutations and saves do not wait for MQTT. Broker failure leaves cleanup outstanding; completion reflects a successful broker publish, not confirmation by every subscriber.

## Persistence and backup

The simulator stores saved and active designs, the edit revision, retired IDs and controller cleanup work in its own SQLite database. `BuildingDesign:SqlitePath` defaults to `building-design.db` relative to the simulator content root (`src/Devices.BuildingControl.Web/building-design.db` with the normal project run). A fresh database is seeded once. Schema version 4 migrates versions 1–3, retaining saved and active designs and revisions; versions 1–2 stored drafts are discarded. Unknown versions and nonempty unversioned databases are rejected. A version 1 migration can retire IDs visible in its active design but cannot reconstruct earlier deleted IDs. The table definitions are in the [building editor guide's schema](building-editor.md#persistence-and-activation); the separate instrumentation telemetry schema is in the [instrumentation guide](building-instrumentation.md#persistence).

The project directory was renamed; a database at an old `src/Devices.Simulator.Web/building-design.db` or `src/Devices.BuildingConfigurator.Web/building-design.db` path is not automatically moved or loaded. To keep it, use a validated backup or set `BuildingDesign:SqlitePath` explicitly. Compose uses its existing named volume and is unaffected by the project directory rename.

Save transactionally stores the saved design. Activation is separate: retained device IDs preserve compatible in-memory state, removed devices are dropped, and removed-controller cleanup is queued only when activation succeeds. On startup the last active design is restored, then a different saved revision is retried; a failed retry leaves the old active design. Activation failure status is recomputed by the startup attempt, rather than stored as a durable failure record. After a runtime activation failure, use the editor retry action or restart; there is no separate periodic activation retry. Cleanup state is durable and retried asynchronously.

For a consistent live backup, use SQLite's online backup API. From the repository root, with Python installed:

```powershell
python -c "import sqlite3; source=sqlite3.connect(r'src\Devices.BuildingControl.Web\building-design.db'); backup=sqlite3.connect('building-design-backup.db'); source.backup(backup); backup.close(); source.close()"
python -c "import sqlite3; db=sqlite3.connect('building-design-backup.db'); print(db.execute('PRAGMA integrity_check').fetchone(), db.execute('PRAGMA user_version').fetchone()); db.close()"
```

Confirm integrity is `ok` and schema version is supported before restoring. Stop the simulator, retain a recovery copy, replace the database with the validated backup, and restart. For Compose, stop the simulator before copying or restoring the file in the `building-design-data` volume; do not copy a live SQLite database without its online backup API. Design and telemetry databases are separate: restoring an older design alone can make instrumentation reject its older revision or retired IDs; plan a consistent recovery of both stores. Automatic backups are not implemented.

## Source tree

```text
src/Devices.Contracts/
  BuildingDesign.cs          design records, validation, baseline seed
  BuildingDeviceConnector.cs connector contracts and shared results
src/Devices.Connectors.Simulation/
  BuildingSimulator.cs       simulation state and mutations
  BuildingSimulator.Design.cs active design reconciliation
src/Devices.BuildingControl.Web/
  Devices.BuildingControl.Web.csproj
  Program.cs                 application setup and HTTP endpoints
  Building/
    BuildingDesignStore.cs   SQLite persistence, revision checks and cleanup
  Editor/
    BuildingEditorService.cs editor operations and activation
    BuildingEditor.http      manual HTTP examples (writes replace data)
    EditorAccessPolicy.cs    local editor access checks
  Mqtt/
    ControllerCleanupProcessor.cs revision-fenced cleanup processing
    MqttCommandRouting.cs    command topic and ID validation
    MqttTelemetryPublisher.cs telemetry publishing and commands
  Security/
    LocalMutationPolicy.cs   simulator mutation checks
    SimulatorCapabilities.cs browser capability endpoint
  appsettings.json
  Properties/launchSettings.json
  wwwroot/
    index.html   semantic page structure and frontend bundle references
    dist/        generated app.js and app.css bundles
    vendor/      local Three.js and OrbitControls modules
  frontend/
    editor/              building editor component, types, validation and session state
    scene/               Three.js scene, access geometry, floor views and fixture helpers
    shared/              UI models, English localization and mutation-access checks
    main.tsx             React entry point
    SimulatorApp.tsx     simulator state, controls and status UI
    simulator.css        simulator and editor responsive styles
```

Shared contracts and IDs are in [Devices.Contracts](../../src/Devices.Contracts/).

## Configuration

`appsettings.json`:

```json
{
  "Mqtt": {
    "Host": "localhost",
    "Port": 1883
  },
  "Urls": "http://localhost:5080"
}
```

An unavailable broker does not block HTTP simulation. MQTT status is exposed through `/api/status`.

The default design path above may be overridden with `BuildingDesign:SqlitePath` or `BuildingDesign__SqlitePath`. Compose sets it to `/data/building-design.db` in the `building-design-data` volume; the container listens on `0.0.0.0:8080`, its host port is loopback-only, and editor access is disabled.

## Running and testing

From the repository root, build the local browser assets before running the simulator directly; the Dockerfile does this automatically:

```powershell
npm ci
npm run build
```

`npm run build` starts with strict TypeScript typechecking. See the [frontend test commands](../README.md#frontend-build-and-tests) for Node-based browser tests.

```powershell
dotnet run --project src\Devices.BuildingControl.Web\Devices.BuildingControl.Web.csproj --urls http://localhost:5080
dotnet test tests\Devices.Simulator.Tests\Devices.Simulator.Tests.csproj
node --import tsx --test tests\building-access.test.mjs tests\wiring-routes.test.mjs tests\floor-view.test.mjs tests\room-state.test.mjs tests\record-demo.test.mjs tests\localization-en.test.mjs tests\building-design-view.test.mjs tests\building-editor.test.mjs tests\building-editor-ui.test.mjs tests\simulator-react-model.test.mjs
```

The simulator view-logic tests require Node.js.

The simulator test suite includes a broker-backed integration test of simulator publication, instrumentation ingestion, snapshot reconciliation and retained-message cleanup. It uses an isolated, anonymous Mosquitto container bound to a dynamic loopback port and skips if Docker or a locally cached `eclipse-mosquitto:2` image is unavailable. To make the image available and run that test from the repository root:

```powershell
docker pull eclipse-mosquitto:2
dotnet test tests\Devices.Simulator.Tests\Devices.Simulator.Tests.csproj --filter "FullyQualifiedName~MqttEndToEndTests"
```

The test invokes the simulator and instrumentation components in-process and applies the snapshot directly; it does not exercise HTTP polling, broker disconnects or process restarts. The anonymous broker is only for the isolated test, not deployment.
