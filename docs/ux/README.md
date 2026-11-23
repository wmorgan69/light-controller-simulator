# UX design references

The static, non-interactive design references below document the existing applications, not a proposed redesign. Values and statuses are illustrative snapshots and do not represent live telemetry. The desktop high-fidelity references reuse the supplied application screenshots; the mobile high-fidelity designs are illustrative renderings, not browser captures. Scroll to see the full mobile page.

| Application | Desktop wireframe | Mobile wireframe | Desktop high fidelity | Mobile high fidelity |
|---|---|---|---|---|
| Building Light Simulator | [SVG](simulator/wireframe-web.svg) | [SVG](simulator/wireframe-mobile.svg) | [PNG](simulator/hidef-web.png) | [SVG](simulator/hidef-mobile.svg) |
| Lighting Instrumentation | [SVG](instrumentation/wireframe-web.svg) | [SVG](instrumentation/wireframe-mobile.svg) | [PNG](instrumentation/hidef-web.png) | [SVG](instrumentation/hidef-mobile.svg) |

## Design language

The [repository instructions](../../AGENTS.md#ui-implementation-standards) direct UI work to these guides; the [UX reviewer](../../.github/agents/ux-reviewer.agent.md) assesses changed UI against the shared targets.

- [Shared design language](design-language.md) - baseline targets for new and changed interfaces across both apps.
- [Building Light Simulator](simulator/design-language.md) - colors, typography, layout, controls, and responsive dimensions.
- [Lighting Instrumentation](instrumentation/design-language.md) - colors, typography, dashboard components, and responsive dimensions.

The simulator desktop reference shows the building overview; the [selected-floor screenshot](../assets/screenshots/building-light-simulator-selected-floor.png) shows the room inspector and wiring. The wireframes use a selected floor to show those controls. Both mobile layouts represent a narrow viewport and show content below the fold. Statuses use text as well as color, and the simulator retains its non-3D accessible controls.

See the [simulator guide](../building-light-simulator.md#user-interactions) and [instrumentation guide](../lighting-instrumentation.md#dashboard-information-hierarchy) for current behavior, loading and error states, and accessibility details.
