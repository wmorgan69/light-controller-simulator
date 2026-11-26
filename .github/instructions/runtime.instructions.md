---
applyTo: "src/**/*.cs,src/**/*.csproj,src/**/*.resx,src/**/appsettings*.json,tests/**/*.cs,tests/**/*.csproj,Devices.slnx,Dockerfile,deploy/docker/**"
---

# .NET, contracts, and runtime rules

- Follow existing .NET naming, namespaces, file placement, dependency injection, nullable, async, and test patterns. Do not introduce a framework or architecture without demonstrated need.
- Preserve type safety: avoid unnecessary casts, `dynamic`, and unvalidated deserialization. Reuse models and serializers.
- Use cancellation tokens for cancellable operations; avoid blocking async code. Keep hosted services and polling bounded and non-overlapping.
- Validate external input at API boundaries and return explicit HTTP errors rather than success-shaped fallbacks.
- Update one authoritative state model; derive UI and published telemetry from it. Mutations return the resulting state needed by callers without a redundant refresh.
- Clearing/changing faults must recompute controller status and related visuals from remaining faults.
- Require stable controller, room, sensor, fault, and light-strip IDs; never derive keys from display text.
- MQTT publication must not block HTTP mutation responses. HTTP is the source of current browser-interaction state.
- Maintain shared room names in `src/Devices.Contracts/RoomNames.resx`, preserving culture-independent HTTP/MQTT values. Do not translate stable IDs, protocol values, user descriptions, or unknown telemetry. English is the only supported language unless requested otherwise.
- Inspect shared contracts and connector consumers when a change crosses the Building Control, simulation connector, and instrumentation boundaries; do not restrict contract review to one application folder.
