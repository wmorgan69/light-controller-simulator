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

The building editor is part of the [Building Control](building-control.md). It edits a building's dimensions, floors, rooms, doors, sensors, light strips, controllers, walkways, stairs and logical connections. The plan and wiring are illustrative, not an electrical or compliance design.

The [editor specification](../plans/building-editor-spec.md) describes the design contract, validation rules, state flow and remaining gaps. The [editor UX guide](../ux/building-control/editor/ux.md) describes the interface.

## Running locally

From the repository root in PowerShell:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet run --no-launch-profile --project src\Devices.BuildingControl.Web\Devices.BuildingControl.Web.csproj --urls http://localhost:5080
```

Open `http://localhost:5080/`, then choose **Building menu** and **Edit building**. Use a direct loopback connection: the editor is available only in Development, with loopback client and server addresses and listeners, a matching loopback host, scheme and port, and no forwarding headers. Editor mutations require a same-origin `Origin`. The editor has no authentication; local users and processes share access. Compose disables simulator HTTP mutations and does not expose editor access.

The browser checks `GET /api/capabilities`; `editorAllowed` must be `true`. Otherwise the menu's edit item is disabled and its access status explains the restriction. Do not expose the simulator through a proxy or a non-loopback listener.

## Editing and saving

Opening the editor loads the saved design. Multiple editors may work concurrently. Applied design changes exist only in the open browser session until saved. Undo/redo history and unapplied form values are session-only and are not saved with the design. **Exit editor** confirms before discarding unsaved changes; closing or reloading also loses session-only state. JSON export can preserve local work, including a marked recovery export when pending form values cannot form a valid design.

**Start blank** replaces the editor design with one empty floor in a 20 × 20 m building. **Start with default building** uses the four-floor layout in a 10 × 8 m footprint. Both ask for confirmation, discard unapplied form values, and can be undone before or after saving. They do not affect the saved or running design until **Save and activate**. The replacement uses new identities, so saving it replaces the previous devices and schedules removed controllers for cleanup.

The plan's icon toolbar selects select, move, room, door, light, walkway and stairs tools. Tooltips identify the icons, and the active tool is shown in text. In select or move mode, drag an existing item to move it. The preview snaps to the 0.5 m grid; moving a room also translates its fixtures. Escape cancels the preview, and a completed move is one undoable edit. Pending form values require confirmation before they are replaced. An invalid drop remains in the session with a validation message and must be corrected before saving. Creation and move tools also support click-to-place; the item list and labelled forms remain available for selection and precise positioning without dragging. The item list offers buttons to add a walkway or stairs at the origin, then edit their properties. Stairs begin on the selected lower floor and connect to the next numbered floor; the upper floor shows the incoming stairs and links back to their properties. A walkway or stairs can be resized, moved, or deleted with confirmation and undo. Removing upper floors also removes stairs that would no longer connect to a floor. Each room requires a sensor and each floor requires a controller. Logical plan connections use right-angle routes and are not physical cable routes.

Doors appear as wall-aligned rectangles and controllers as boxes on the plan. Zoom and pan controls provide a closer view; **Fit all** restores the full plan and its exterior margin. Room labels are clipped to their boundaries, with full names available in **Items and connections** and the selection label. To delete an item, select it on the plan or in **Items and connections**, then choose **Delete selected item** above the plan and confirm. Controllers and sensors cannot be deleted independently.

**Save and activate** validates and persists the design, then attempts activation. The editor shows a brief status and highlights pending or failed controller cleanup; expandable details show saved and running revisions, activation status and cleanup counts. A successful save does not guarantee activation: if activation fails, the previous design remains running and the saved design can be retried. Undo after saving creates new unsaved changes.

```mermaid
---
config:
  theme: base
  themeVariables:
    darkMode: true
    primaryColor: '#1E293B'
    primaryTextColor: '#F8FAFC'
    primaryBorderColor: '#60A5FA'
    lineColor: '#60A5FA'
    edgeLabelBackground: '#1E293B'
    textColor: '#F8FAFC'
---
flowchart TB
    Access("Check editor access") -->|allowed| Load("Load saved design")
    Access -->|unavailable| View("Show access status; viewing remains available")
    Load -->|failure| LoadError("Show error; retry or return")
    LoadError -->|retry| Load
    Load -->|loaded| Edit("Edit in browser memory")
    Edit -->|save| Validate("Validate local design")
    Validate -->|invalid| Edit
    Validate -->|valid| Save("Save with expected revision")
    Save -->|conflict| Recovery("Export local edits if needed")
    Recovery --> Reload("Discard edits and load saved design")
    Reload --> Edit
    Save -->|saved| Activate("Attempt activation")
    Activate -->|success| Active("Running design updated")
    Activate -->|failure| Failed("Previous design remains running")
    Failed -->|retry or restart| Activate
    classDef default fill:#1E293B,stroke:#60A5FA,color:#F8FAFC;
```

## Design and validation

Design JSON contains `revision`, `width`, `depth` and `floors`. A floor contains its stable ID, number, controller ID and position, rooms, and optional walkway and stair arrays. Each room contains its stable ID, name, geometry, one sensor, doors and light strips; sensors and lights reference a controller. Each walkway and stair has an ID and rectangle in metres; each stair has an ascent direction. Stairs connect adjacent floors. Legacy null or absent arrays are represented as editable objects when opened and are persisted on save; empty arrays mean no corresponding objects. Existing saved and active designs retain their dimensions and coordinates. The 3D view uses the active design geometry at every revision and generates missing legacy access in memory; no stored design is rewritten merely by viewing it.

For save, the server requires 1–10 consecutively numbered floors, dimensions from 2–100 metres on a 0.5-metre grid, and non-overlapping rooms within the building footprint. Doors must lie on room boundaries; sensors and lights must lie within or on their rooms and connect to their floor's controller. IDs must be unique, safe and stable; retired IDs cannot be reused. Server validation is authoritative and returns field-path errors. See the [complete validation rules](../plans/building-editor-spec.md#building-design-and-validation).

## API and concurrency

The simulator exposes these editor endpoints using camelCase JSON:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/building-editor` | Read saved and active designs, edit revision, activation and cleanup status |
| `GET` | `/api/building-editor/default-design` | Read the original four-floor template without changing saved or running state |
| `POST` | `/api/building-editor/save` | Save `{ "expectedRevision": n, "design": {...} }` and attempt activation |
| `POST` | `/api/building-editor/retry` | Retry activation |
| `POST` | `/api/building-editor/retry-cleanup` | Request asynchronous controller cleanup retry |

Use the returned `editRevision` as the next save's `expectedRevision`. A stale revision returns `409`, invalid designs return `400`, and disallowed editor requests return `403`. On conflict, the browser keeps local changes for export and requires explicit reconciliation before saving.

`GET /api/building-design-status` is not editor-restricted; it reports saved and running revisions, activation status and cleanup counts. `GET /api/building-view` returns the active design and current controllers. The [HTTP examples](../../src/Devices.BuildingControl.Web/Editor/BuildingEditor.http) include save and retry requests. **The save example replaces the building**; use an isolated database.

## Persistence and activation

`BuildingDesign:SqlitePath` defaults to `building-design.db` relative to the simulator content root. The database stores saved and active designs, edit revision, retired IDs and cleanup work. Schema version 4 migrates versions 1–3, retaining saved and active designs and revision; migration from versions 1–2 discards stored drafts. Unknown schema versions and nonempty unversioned databases are rejected. For backup instructions, see [simulator persistence and backup](building-control.md#persistence-and-backup).

[BuildingDesignStore.cs](../../src/Devices.BuildingControl.Web/Building/BuildingDesignStore.cs) initializes a fresh database with this version 4 schema:

```sql
CREATE TABLE building_design (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    saved TEXT NOT NULL, active TEXT NOT NULL,
    edit_revision INTEGER NOT NULL
);
CREATE TABLE retired_design_id (id TEXT PRIMARY KEY);
CREATE TABLE controller_cleanup (
    controller_id TEXT PRIMARY KEY,
    active_revision INTEGER NOT NULL,
    status INTEGER NOT NULL
);
PRAGMA user_version = 4;
```

`building_design` is a single-row table whose `saved` and `active` columns hold the camelCase design JSON; each design carries its own `revision`, and `edit_revision` is the optimistic-concurrency revision compared on save. `retired_design_id` lists stable IDs that can never be reused. `controller_cleanup` tracks removed-controller MQTT cleanup, fenced by `active_revision`; `status` values are `0` pending, `1` completed, `2` cancelled and `3` failed. The separate instrumentation telemetry schema is in the [instrumentation guide](building-instrumentation.md#persistence).

Save and activation are separate. Activation preserves compatible live state for retained device IDs and queues removed-controller MQTT cleanup only after activation succeeds. On startup, the last active design is restored and a different saved revision is retried. Cleanup is durable and asynchronous; its status represents broker publication, not acknowledgement by every subscriber. See the [runtime and persistence flow](../plans/building-editor-spec.md#persistence-and-runtime-integration).

```mermaid
---
config:
  theme: base
  themeVariables:
    darkMode: true
    primaryColor: '#1E293B'
    primaryTextColor: '#F8FAFC'
    primaryBorderColor: '#60A5FA'
    lineColor: '#60A5FA'
    edgeLabelBackground: '#1E293B'
    textColor: '#F8FAFC'
---
flowchart TB
    Editor("Browser editor") -->|save| API("Building Control editor API")
    API -->|store saved design| DB("Design SQLite")
    API -->|attempt activation| Connector("Simulated device connector")
    DB -->|startup: read designs| Restore("Connector restores active design")
    Restore --> Compare("Compare saved and active revisions")
    Compare -->|different: retry saved| Connector
    Compare -->|same| Ready("Continue with active design")
    Connector -->|saved design activation callback| Commit("Editor service commits active design")
    Commit -->|success: enqueue removed controllers| DB
    Connector -->|saved activation fails| Previous("Previous design remains running")
    Connector -->|current controller state| Snapshot("Building Control snapshot API")
    Snapshot -->|HTTP polling| Instrumentation("Lighting Instrumentation")
    DB -->|pending or failed cleanup| Publisher("MQTT publisher")
    Publisher -->|clear retained controller state| Broker("MQTT broker")
    Broker -->|optional telemetry| Instrumentation
    classDef default fill:#1E293B,stroke:#60A5FA,color:#F8FAFC;
```

## Failure and recovery

- **Save fails:** local edits remain in the open browser. Correct validation errors or retry; export before leaving if needed.
- **Revision conflict:** editing stops. Export local work, or explicitly discard it and load the current saved design.
- **Activation pending or failed:** the saved design may differ from the running design. Retry activation or restart the simulator to retry.
- **Cleanup pending or failed:** the publisher retries while MQTT is connected. The editor also offers a retry action.
- **Access unavailable:** viewing remains available, but editor controls are disabled. Check the Development and loopback requirements above.

## Implementation and tests

The editor interface is the React component [BuildingEditor.tsx](../../src/Devices.BuildingControl.Web/frontend/editor/BuildingEditor.tsx), with editor-specific types in [BuildingEditor.types.ts](../../src/Devices.BuildingControl.Web/frontend/editor/BuildingEditor.types.ts). Its TypeScript helpers [building-editor.ts](../../src/Devices.BuildingControl.Web/frontend/editor/building-editor.ts) and [building-editor-state.ts](../../src/Devices.BuildingControl.Web/frontend/editor/building-editor-state.ts) handle validation and session state. The server uses [BuildingEditorService.cs](../../src/Devices.BuildingControl.Web/Editor/BuildingEditorService.cs), [BuildingDesignStore.cs](../../src/Devices.BuildingControl.Web/Building/BuildingDesignStore.cs), and [BuildingDesign.cs](../../src/Devices.Contracts/BuildingDesign.cs). Access policy is enforced by [EditorAccessPolicy.cs](../../src/Devices.BuildingControl.Web/Editor/EditorAccessPolicy.cs).

From the repository root:

```powershell
dotnet test tests\Devices.Simulator.Tests\Devices.Simulator.Tests.csproj --filter "FullyQualifiedName~BuildingDesignTests|FullyQualifiedName~BuildingEditorServiceTests|FullyQualifiedName~EditorAccessPolicyTests"
node --import tsx --test tests\building-editor.test.mjs tests\building-editor-ui.test.mjs tests\localization-en.test.mjs
npm run test:components
```

These focused tests supplement the solution build and test commands in the [simulator guide](building-control.md#running-and-testing).
