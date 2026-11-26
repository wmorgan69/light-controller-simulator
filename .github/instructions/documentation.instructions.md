---
applyTo: "docs/**/*.md,docs/assets/diagrams/**/*.svg,.github/**/*.md,AGENTS.md,README.md"
---

# Documentation rules

- Keep [docs/README.md](../../docs/README.md) as the documentation table of contents; update it when adding a top-level guide.
- Maintain separate [Building Control](../../docs/technical/building-control.md) and [Lighting Instrumentation](../../docs/technical/building-instrumentation.md) guides.
- Describe current behavior; label unimplemented proposals in remaining/open sections. Keep documentation consistent with source, tests, relevant plan sections, and observed UI.
- Document affected ports, configuration keys/defaults, HTTP endpoints, MQTT topics, run/test commands, source layout, workflow, and UX in the same change.
- Use descriptive headings/links, readable lists/tables, repository-relative Markdown links, and language-tagged code fences. Synchronize tables of contents and verify every changed link and Mermaid block.
- Keep source maps representative; omit generated `bin/`, `obj/`, and transient SQLite artifacts. Examples must run from the repository root.
- Include a Mermaid diagram for changed boundaries, state/message flows, runtime sequences, or major component relationships. Use an accessible static SVG if reliable Mermaid rendering is unavailable.
- Match the [simulator runtime diagram](../../docs/assets/diagrams/building-control-runtime.svg): dark-blue rounded nodes/label backgrounds (`#1E293B`), blue outlines/arrows (`#60A5FA`), light labels (`#F8FAFC`), spacious rows, and legible non-overlapping connectors.
- Use syntax supported by the diagram type; verify rendering and contrast in light/dark preview. Clearly report unavailable rendering checks.
- Independent code review must confirm affected documentation is complete and accurate. UX documentation changes describing changed UI behavior also require UX review.
