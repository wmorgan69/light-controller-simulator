# Building editor

## Table of contents

- [Purpose](#purpose)
- [Running locally](#running-locally)
- [Editing and saving](#editing-and-saving)
- [Design and validation](#design-and-validation)
- [API and concurrency](#api-and-concurrency)
- [Persistence and activation](#persistence-and-activation)
- [Failure and recovery](#failure-and-recovery)
- [Implementation and tests](#implementation-and-tests)

## Purpose

The building editor is part of the [Building Light Simulator](building-light-simulator.md). It edits a building's dimensions, floors, rooms, doors, sensors, light strips, controllers and logical connections. The plan and wiring are illustrative, not an electrical or compliance design.

The [editor specification](../plans/building-editor-spec.md) describes the design contract, validation rules, state flow and remaining gaps. The [editor UX guide](../ux/simulator/editor/ux.md) describes the interface.

## Running locally

From the repository root in PowerShell:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet run --no-launch-profile --project src\Devices.Simulator.Web\Devices.Simulator.Web.csproj --urls http://localhost:5080
```

Open `http://localhost:5080/`, then choose **Building menu** and **Edit building**. Use a direct loopback connection: the editor is available only in Development, with loopback client and server addresses and listeners, a matching loopback host, scheme and port, and no forwarding headers. Editor mutations require a same-origin `Origin`. The editor has no authentication; local users and processes share access. Compose disables simulator HTTP mutations and does not expose editor access.

The browser checks `GET /api/capabilities`; `editorAllowed` must be `true`. Do not expose the simulator through a proxy or a non-loopback listener.

## Editing and saving

Opening the editor loads the saved design. Multiple editors may work concurrently. Applied design changes exist only in the open browser session until saved. Undo/redo history and unapplied form values are session-only and are not saved with the design. **Exit editor** confirms before discarding unsaved changes; closing or reloading also loses session-only state. JSON export can preserve local work, including a marked recovery export when pending form values cannot form a valid design.

**Save and activate** validates and persists the design, then attempts activation. The editor displays saved and running revisions, activation status and controller cleanup counts. A successful save does not guarantee activation: if activation fails, the previous design remains running and the saved design can be retried. Undo after saving creates new unsaved changes.

## Design and validation

Design JSON contains `revision`, `width`, `depth` and `floors`. A floor contains its stable ID, number, controller ID and position, and rooms. Each room contains its stable ID, name, geometry, one sensor, doors and light strips; sensors and lights reference a controller.

For save, the server requires 1–10 consecutively numbered floors, dimensions from 2–100 metres on a 0.5-metre grid, and non-overlapping rooms within the building footprint. Doors must lie on room boundaries; sensors and lights must lie within or on their rooms and connect to their floor's controller. IDs must be unique, safe and stable; retired IDs cannot be reused. Server validation is authoritative and returns field-path errors. See the [complete validation rules](../plans/building-editor-spec.md#building-design-and-validation).

## API and concurrency

The simulator exposes these editor endpoints using camelCase JSON:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/building-editor` | Read saved and active designs, edit revision, activation and cleanup status |
| `POST` | `/api/building-editor/save` | Save `{ "expectedRevision": n, "design": {...} }` and attempt activation |
| `POST` | `/api/building-editor/retry` | Retry activation |
| `POST` | `/api/building-editor/retry-cleanup` | Request asynchronous controller cleanup retry |

Use the returned `editRevision` as the next save's `expectedRevision`. A stale revision returns `409`, invalid designs return `400`, and disallowed editor requests return `403`. On conflict, the browser keeps local changes for export and requires explicit reconciliation before saving.

`GET /api/building-design-status` is not editor-restricted; it reports saved and running revisions, activation status and cleanup counts. `GET /api/building-view` returns the active design and current controllers. The [HTTP examples](../../src/Devices.Simulator.Web/Editor/BuildingEditor.http) include save and retry requests. **The save example replaces the building**; use an isolated database.

## Persistence and activation

`BuildingDesign:SqlitePath` defaults to `building-design.db` relative to the simulator content root. The database stores saved and active designs, edit revision, retired IDs and cleanup work. Schema version 4 migrates versions 1–3, retaining saved and active designs and revision; migration from versions 1–2 discards stored drafts. Unknown schema versions and nonempty unversioned databases are rejected. For backup instructions, see [simulator persistence and backup](building-light-simulator.md#persistence-and-backup).

Save and activation are separate. Activation preserves compatible live state for retained device IDs and queues removed-controller MQTT cleanup only after activation succeeds. On startup, the last active design is restored and a different saved revision is retried. Cleanup is durable and asynchronous; its status represents broker publication, not acknowledgement by every subscriber. See the [runtime and persistence flow](../plans/building-editor-spec.md#persistence-and-runtime-integration).

## Failure and recovery

- **Save fails:** local edits remain in the open browser. Correct validation errors or retry; export before leaving if needed.
- **Revision conflict:** editing stops. Export local work, or explicitly discard it and load the current saved design.
- **Activation pending or failed:** the saved design may differ from the running design. Retry activation or restart the simulator to retry.
- **Cleanup pending or failed:** the publisher retries while MQTT is connected. The editor also offers a retry action.
- **Access unavailable:** viewing remains available, but editor controls are disabled. Check the Development and loopback requirements above.

## Implementation and tests

The editor uses [building-editor.mjs](../../src/Devices.Simulator.Web/wwwroot/building-editor.mjs) and [building-editor-state.mjs](../../src/Devices.Simulator.Web/wwwroot/building-editor-state.mjs) in the browser. The server uses [BuildingEditorService.cs](../../src/Devices.Simulator.Web/Editor/BuildingEditorService.cs), [BuildingDesignStore.cs](../../src/Devices.Simulator.Web/Building/BuildingDesignStore.cs), and [BuildingDesign.cs](../../src/Devices.Simulator.Web/Building/BuildingDesign.cs). Access policy is enforced by [EditorAccessPolicy.cs](../../src/Devices.Simulator.Web/Editor/EditorAccessPolicy.cs).

From the repository root:

```powershell
dotnet test tests\Devices.Simulator.Tests\Devices.Simulator.Tests.csproj --filter "FullyQualifiedName~BuildingDesignTests|FullyQualifiedName~BuildingEditorServiceTests|FullyQualifiedName~EditorAccessPolicyTests"
node --test tests\building-editor.test.mjs tests\building-editor-ui.test.mjs tests\localization-en.test.mjs
```

These focused tests supplement the solution build and test commands in the [simulator guide](building-light-simulator.md#running-and-testing).
