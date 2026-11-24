# UX design references

The static, non-interactive design references below illustrate the applications and are not live telemetry. The desktop high-fidelity references reuse the supplied application screenshots; the mobile high-fidelity designs are illustrative renderings, not browser captures. Scroll to see the full mobile page. The editor implementation and its design targets are documented separately below.

| Application | Desktop wireframe | Mobile wireframe | Desktop high fidelity | Mobile high fidelity |
|---|---|---|---|---|
| Building Light Simulator | [SVG](simulator/main/wireframe-web.svg) | [SVG](simulator/main/wireframe-mobile.svg) | [PNG](simulator/main/hidef-web.png) | [SVG](simulator/main/hidef-mobile.svg) |
| Lighting Instrumentation | [SVG](instrumentation/wireframe-web.svg) | [SVG](instrumentation/wireframe-mobile.svg) | [PNG](instrumentation/hidef-web.png) | [SVG](instrumentation/hidef-mobile.svg) |

## Design language

The [repository instructions](../../AGENTS.md#ui-implementation-standards) direct UI work to these guides; the [UX reviewer](../../.github/agents/ux-reviewer.agent.md) assesses changed UI against the shared targets.

- [Shared design language](design-language.md) - baseline targets for new and changed interfaces across both apps.
- [Building Light Simulator](simulator/main/design-language.md) - colors, typography, layout, controls, and responsive dimensions.
- [Lighting Instrumentation](instrumentation/design-language.md) - colors, typography, dashboard components, and responsive dimensions.

The simulator desktop reference shows the building overview; the [selected-floor screenshot](../assets/screenshots/building-light-simulator-selected-floor.png) shows the room inspector and wiring. The wireframes use a selected floor to show those controls. Both mobile layouts represent a narrow viewport and show content below the fold. Statuses use text as well as color, and the simulator retains its non-3D accessible controls.

See the [simulator guide](../technical/building-light-simulator.md#user-interactions) and [instrumentation guide](../technical/lighting-instrumentation.md#dashboard-information-hierarchy) for current behavior, loading and error states, and accessibility details.

## Building editor

- [Specification](../plans/building-editor-spec.md) - current behavior, persistence, access limits, and remaining gaps.
- [UX design](simulator/editor/ux.md) - current tasks, flows, accessibility, and remaining work.
- [UI design](simulator/editor/ui.md) - current layout and dimensioned desktop and mobile design targets.
