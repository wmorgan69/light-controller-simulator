# UX design references

The static, non-interactive references below are not live telemetry. The simulator modernization images are proposed designs, not screenshots or implemented behavior. Instrumentation's desktop reference is a supplied screenshot and its mobile image is illustrative. Scroll to see the full mobile designs.

| Application | Desktop wireframe | Mobile wireframe | Desktop high fidelity | Mobile high fidelity |
|---|---|---|---|---|
| Building Light Simulator | [SVG](simulator/main/wireframe-web.svg) | [SVG](simulator/main/wireframe-mobile.svg) | [Proposed SVG](simulator/main/hidef-web.svg) | [Proposed SVG](simulator/main/hidef-mobile.svg) |
| Building editor | [SVG](simulator/editor/wireframe-web.svg) | [SVG](simulator/editor/wireframe-mobile.svg) | [Proposed SVG](simulator/editor/hidef-web.svg) | [Proposed SVG](simulator/editor/hidef-mobile.svg) |
| Lighting Instrumentation | [SVG](instrumentation/wireframe-web.svg) | [SVG](instrumentation/wireframe-mobile.svg) | [PNG](instrumentation/hidef-web.png) | [SVG](instrumentation/hidef-mobile.svg) |

## Design language

The [repository instructions](../../AGENTS.md#ui-implementation-standards) direct UI work to these guides; the [UX reviewer](../../.github/agents/ux-reviewer.agent.md) assesses changed UI against the shared targets.

- Both applications use React with strict TypeScript and Material UI; the [frontend build and test commands](../README.md#frontend-build-and-tests) cover the Vite bundles served by ASP.NET Core.
- [Shared design language](design-language.md) - baseline targets for new and changed interfaces across both apps.
- [Building Light Simulator](simulator/main/design-language.md) - colors, typography, layout, controls, and responsive dimensions.
- [Lighting Instrumentation](instrumentation/design-language.md) - colors, typography, dashboard components, and responsive dimensions.

The [current simulator overview screenshot](simulator/main/hidef-web.png) and [selected-floor screenshot](../assets/screenshots/building-light-simulator-selected-floor.png) show the existing UI. The proposed simulator mobile image includes a separate drawer-open example. The editor concepts show the plan and properties; they do not represent a working prototype.

See the [simulator guide](../technical/building-light-simulator.md#user-interactions) and [instrumentation guide](../technical/lighting-instrumentation.md#dashboard-information-hierarchy) for current behavior, loading and error states, and accessibility details.

## Building editor

- [Specification](../plans/building-editor-spec.md) - current behavior, persistence, access limits, and remaining gaps.
- [UX design](simulator/editor/ux.md) - current tasks, flows, accessibility, and remaining work.
- [UI design](simulator/editor/ui.md) - current layout and dimensioned desktop and mobile design targets.
