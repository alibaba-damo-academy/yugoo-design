---
name: design-component
description: Compose Yugoo Design DSL panels from the installed component catalog, or extend the shared component library in its development source repository when existing visual forms cannot express a reusable interaction. Not for installing arbitrary frontend code or executing a design Bundle.
---

# Design component authoring

Start from the information the user wants to understand or change, its actual data
and relationships, and the interaction that exposes the result. Choose a visual
form before choosing a component. A new data binding usually does not require a
new component; compose existing visual forms whenever they express the task.

## Compose a panel

If `design_list_panel_components` is available, query the actual installed catalog.
For a chosen component, request `{"name":"record_form","reference":"contract"}`,
`reference: "docs"`, and `reference: "examples"`; follow returned `read` objects
through the same tool. Read `documentation.sharedStandards` once when present.
The catalog describes capability, not the complete parameter or edit contract.
Missing authoring material is a version gap, not permission to invent properties.

Use only registered components. `generated: true` identifies the smaller subset
authorized for AI-generated Panels; authored DSL availability does not imply
generated permission. Bind the real Bundle schema, sources and canonical IDs.
Graphs and detail forms edit the same data, not independent graph facts.
Studio examples are isolated synthetic interaction demonstrations; replace sample
bindings with actual schema fields and validate them before adopting a panel.
Declarations are data, never JSX, generated CSS, scripts, credential fields or
new write grants. Keep read, sample editing, durable save and Agent execution distinct.

## Extend the compiled library

An ordinary Kit cannot install a new executable component. First locate the
Yugoo Design development source repository and its contributor instructions.
If only an installed integration is available, explain that boundary and provide
a scoped development task; do not patch the user's installed plugin or load remote JS.

Read the owning contracts in that checkout:

- `docs/a2ui-component-catalog-contract.md` for registration and authority.
- `docs/panel-uiux-standard.md` for visual forms, controls, spacing and states.
- `docs/dsl-spec.md` and the relevant declaration/renderer source for binding.

Implement a genuinely reusable visual form, not a Bundle-name branch. Keep its
name stable and semantic. A complete change includes:

- Core's `PANEL_COMPONENT_CATALOG` entry and pure-data declaration validation.
- The corresponding shared `PANEL_COMPONENT_RENDERERS` entry and owned styles.
- Binding-aware interactions through existing edit/save ports, with read-only
  behavior and no extra model, filesystem or execution authority.
- Synthetic normal/empty/read-only examples in the shared component examples,
  including required workspace context; describe unsupported preview boundaries.
- Relevant positive/negative binding, rendering, interaction and save regressions.
  Check keyboard focus, narrow containers, long text and actual rendered pixels.

Keep React 18 compatibility, semantic tokens and the confirmed UIUX defaults.
Enable AI generation only after implementing its bounded schema/data bindings
and edit-authority checks; a new name alone cannot authorize generation.
Preserve provenance, licenses, existing native behavior and user-owned content.
Follow the repository's source/export classification rather than publishing or
installing automatically. Report source implementation, UI interaction, durable
save, native consumption and packaged inclusion as separate verified outcomes.
