# Changelog

This log records the project's development from its initial planning through the current working tree, including changes reconstructed from available conversations that do not have individual Git commits. Dates are in UTC. There are no tagged releases in this history, so entries use dates and commit IDs rather than version numbers.

The first commit, `120bfb3`, imported an existing project as well as quality and security changes. Conversation entries group related iterations and record superseded designs as history, not current behavior. They are reconstructed from available session records and may omit details unavailable in those records. The commit ledger below covers the current branch's complete recorded history.

## Initial development — 21–22 November 2026

### Planning and first implementation

- Planned a four-floor simulated building and separate instrumentation application, then created the .NET solution, shared contracts, stable device IDs, and simulator and instrumentation projects.
- Implemented four controllers with rooms, presence sensors, lights, faults, HTTP controls, MQTT telemetry, and a 3D view. The first model had 24 lights and three rooms per floor; later layout changes superseded it.
- Added an instrumentation dashboard with a SQLite-backed telemetry store, controller and event views, and focused tests.

### Interaction and state refinements

- Added labeled rooms, interactive device selection, pan and zoom, and accessible non-3D controls. Iterated from anchored menus and floor control strips to in-model switches, then replaced those switches with a compact room inspector for presence and sensor faults.
- Added selected-floor emphasis, a selected-room highlight, automatic main-room selection, and a Floor 3 startup selection. Later navigation changes replaced the earlier faded-floor and cutaway designs.
- Made browser state update from HTTP mutations without waiting for MQTT publication. Fixed fault clearing so controller status and visual state are recomputed, and fixed selection and fault-handling issues found during review.
- Redesigned instrumentation with building summary cards, lighting activity, floor and room information, and recent events. Added HTTP polling fallback so it reports current state without a broker.
- Fixed HTTP fallback event ingestion after simulator revision resets while retaining MQTT revision protection. Resolved relative SQLite paths against the instrumentation project to avoid duplicate runtime databases.

### IoT, scenarios, and workflow

- Added retained MQTT snapshots, reconnect handling, controller revision and replay protection, command acknowledgements, stale/offline detection, and transport status. Added target validation and MQTT fault commands for sensors, light strips, and controllers.
- Bundled Three.js and OrbitControls locally rather than relying on a runtime CDN.
- Added reset and occupancy scenarios. Changed the occupancy demo from a fixed office selection to one or two random rooms per floor, subject to room availability.
- Added repository instructions, independent code and UX reviewers, a build-review-rebuild agent, clean-code and testing standards, and documentation-review requirements. Later additions introduced security review and coverage guidance.
- Added the main README, separate application guides, a documentation table of contents, architecture and runtime diagrams, run/test instructions, and the project plan under `docs`.
- Added a Dockerfile and Compose configuration for both sites, with networked HTTP polling and persistent instrumentation data. Added ignores for generated output, runtime databases, and exported image archives.

### Visual design and documentation iterations

- Added illustrative sensor and light wiring, then made wiring automatic on the selected floor and hidden in the all-floors view. Added a color key and refined routing and spacing.
- Explored raised floors and a floor-focused cutaway with translucent pillars before moving to a floor navigation panel beside the selected-floor view. The panel includes floor status, occupancy, reset, and occupancy-demo controls; it moves above the view on narrow screens.
- Moved sensors to ceiling height, refined their separation from fixtures, adjusted camera framing and controls, and removed redundant selection labels.
- Added screenshots and walkthrough video assets under `docs`, organized diagrams, screenshots, and videos into separate folders, and updated the recording helper and documentation.
- Reworked diagrams that did not reliably render in Markdown previews, using matching blue SVGs where needed. Refined the documentation directory tree and added a selected-floor screenshot.

These features formed the initial Git baseline; the model and interface were further changed after that baseline. See the [simulator guide](building-light-simulator.md) and [instrumentation guide](lighting-instrumentation.md) for current behavior.

## Recorded commits — 22 November 2026

In chronological order:

| Commit | Change |
|---|---|
| `120bfb3` | Imported the existing solution and added coverage enforcement, security-review guidance, Dependabot configuration, and quality documentation. |
| `b1dfb63` | Added an implementation summary for coverage and security review. |
| `3d71ef3` | Added a developer quick reference. |
| `8cb228a` | Added a final summary and completion status. |
| `78b6069` | Added coverage verification to the code-review checklist. |
| `aaf6b32` | Added security and coverage reviews to the agent workflow diagram. |
| `19da2e5` | Improved the workflow diagram's layout and clarity. |
| `99c9508` | Made the workflow diagram more compact. |
| `be1cb0d` | Removed unsupported font-size CSS to fix diagram rendering. |
| `2bb8dc9` | Fixed diagram rendering by removing unescaped ampersands. |
| `5aaf6f5` | Simplified the Mermaid diagram to address rendering. |
| `60084e6` | Restored a horizontal workflow diagram layout. |
| `95f5b11` | Restored decision nodes in the horizontal diagram. |
| `b1eaf62` | Compacted diagram labels for wrapping. |
| `393391e` | Enlarged the diagram and adjusted its curves. |
| `2ccbecf` | Replaced the workflow Mermaid diagram with SVG for reliable rendering. |
| `6339fe0` | Corrected the SVG diagram's paths and alignment. |
| `89a2ec1` | Fixed restoration of light state when faults are cleared. |
| `90c7b47` | Fixed flaky telemetry event tests. |
| `05d20fc` | Added simulator edge-case and boundary tests. |
| `8298193` | Added GitHub Pages deployment and a demo page. |
| `7fe4c90` | Enhanced CI and documentation. |
| `eaff099` | Clarified feedback loops in the agent workflow documentation. |
| `2697ce3` | Added the pull request to the workflow diagram. |
| `e4d787b` | Added retries for transient smoke-test readiness failures. |
| `0d31149` | Updated the selected-floor screenshot description and full-size link. |

The available conversation records also describe choosing the `light-controller-simulator` repository name, refining the demo's GitHub Pages presentation, and auditing documentation for accurate CI, coverage, deployment, and recording guidance.

## Recorded commits — 23 November 2026

| Commit | Change |
|---|---|
| `875b74c` | Enhanced the simulator's building layouts, stairs, doors and access routes, room and lighting visuals, floor navigation, camera behavior, and room names. Updated screenshots, diagrams, the walkthrough, documentation, and focused tests. |

The revised walkthrough shows floor selection, camera movement, presence and fault changes, instrumentation updates, and the occupancy demo. The building model now has nine named rooms and 37 light strips; see the [project plan](plan.md) for the current layout.

### Conversation-driven refinements included in `875b74c`

- Added pan, zoom, and full 360-degree rotation demonstrations in both building and selected-floor views. The recording uses a browser-style address strip to distinguish the two local sites.
- Added warm room illumination and translucent light rays, then adjusted their width and visibility. Main rooms on Floors 1 and 3 changed to two rows of three lights.
- Distinguished sensor faults from selected-room highlighting, added fault pulsing with reduced-motion behavior, aligned sensors with wiring, and separated sensor and light routes.
- Changed Floor 2 to a larger main room and one office, and Floor 4 to a single larger room. Floors 1 and 3 retained a main room and two offices.
- Added stairs behind the offices, with opposing flights, shared landings, floor openings, and selected-floor stair sections. Added doors and rear walkways connecting rooms to the stairs, and refined their proportions.
- Named the rooms: Open Workspace, Reception Office, Support Office, Boardroom, Meeting Office, Collaboration Space, Project Office, Focus Office, and The Forum.
- Refreshed screenshots, documentation diagrams, and the walkthrough. The video cycles through the floor layouts, shows the presence and fault controls and lighting changes, and holds each corresponding instrumentation view for five seconds.
- Refined the occupancy-demo recording to select **All floors**, show the popup and click, show lights turning on, and hold the instrumentation view for five seconds.

## Upcoming release — 23 November 2026

The following changes are prepared for the next release and are not included in the commits listed above:

- Added English browser localization resources for both applications and an embedded English resource for shared room names. Static HTML retains matching English fallbacks; there is no language selector or automatic language negotiation.
- Kept stable IDs and protocol values unchanged, and kept shared room names independent of server UI culture.
- Added localization, dashboard rendering, escaping, and error/recovery tests; updated CI test commands and application documentation.
- Added localization guidance to the repository's agent instructions.
- Added this changelog, including conversation-driven changes and the recorded commit history.
