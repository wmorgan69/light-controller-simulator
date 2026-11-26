---
applyTo: "src/Devices.BuildingControl.Web/frontend/**,src/Devices.Instrumentation.Web/frontend/**,src/**/wwwroot/*.html,tests/**/*.test.mjs,tests/**/*.component.test.*,docs/assets/*.mjs,package.json,vite.config.js,vitest.config.js,tsconfig.json,eslint.config.js"
---

# Browser and localization rules

- Consult relevant sections of the [shared design language](../../docs/ux/design-language.md) and the affected application's [Building Control](../../docs/ux/building-control/main/design-language.md) or [instrumentation](../../docs/ux/instrumentation/design-language.md) guide. Shared targets apply to new/changed UI; do not require unrelated legacy changes.
- Follow existing markup, CSS, rendering, and accessibility patterns. Synchronize UI with server-returned state; avoid stale optimistic updates.
- Use semantic HTML and meaningful labels/headings. Pair status colors with text/icons and distinguish loading, waiting, empty, error, healthy, faulted, and offline states visually and programmatically.
- Do not display metrics or trends without telemetry sources. Use stable IDs, not display text, for UI keys.
- Respect reduced motion and keyboard needs. Mirror required browser-only controls through an accessible non-3D or API path.
- Verify live data and important state transitions at desktop and narrow-mobile widths, including horizontal overflow and relevant breakpoint boundaries.
- Designate one browser-evidence owner. Share revision, viewport sizes, states/actions checked, captures, and limitations with the UX reviewer. Reuse applicable evidence; capture again when fixes invalidate it. Screenshots do not prove keyboard behavior, live transitions, or continuous motion.
- Put interface text, accessibility labels, and status/errors in simulator `frontend/shared/localization.en.ts` or instrumentation `frontend/localization.en.ts`. Keep English HTML text/attribute fallbacks synchronized.
- Shared room names belong in `src/Devices.Contracts/RoomNames.resx`. Do not translate IDs, protocol values, user descriptions, or unknown telemetry.
- Use placeholders and plural forms for dynamic text; preserve escaping of external values. Add focused interpolation, pluralization, fallback, and rendering tests where behavior changes.
- English is the only supported language; do not add translations, negotiation, or language controls unless requested.
