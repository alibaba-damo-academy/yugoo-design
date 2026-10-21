# Page navigation canvas

Shared representation entry. Read [the Page output contract](artifact-contract.md)
for map/artifact authority, preview contexts, file validators and failure handling.
For new design read [task-to-page-method.md](task-to-page-method.md) as directed by
the existing SKILL. Reconstruction preserves observed organization rather than
running forward task synthesis or choosing a new aesthetic.

## Facts, nodes and connections

`page_design/page_design.json` owns Page IDs, orders, entry Pages, hierarchy,
connections and accepted HTML refs. One node is one Page; a directional edge is
a meaningful jump with a source-owned trigger label. Hierarchy, navigation menu
membership and shared-shell membership are different and do not imply jumps.
Generated Page HTML remains a file-backed artifact, not a second map/SVG.

## Groups, positions, routing and labels

The current `navigation_workspace` binds pages, connections and canvas sections.
Preserve user-authored `canvas_position` and section membership/geometry; these
are explicit layout data, not executable product facts. Initial maps let the
installed renderer lay out nodes rather than inventing coordinate fields.
The renderer owns ports/routing/measurement; do not replace its navigation
grammar with AI model/knowledge bands. Names/trigger labels must be legible and
identify the actual Page/jump. Viewport, zoom and selection remain local UI.

## Unknowns, interaction and saving

Missing accepted HTML is planned/unavailable, not a completed Page. Missing
upstream evidence is reported; do not invent function or Style IDs. Canvas and
form use the same map/save path. A layout-only save changes no Page behavior;
a connection/semantic revision checks the smallest affected artifact set, as
specified in the existing contract. Already-persisted diffs are not replayed.
Keep accepted unrelated artifacts and exact style/source pins. Preview context
selects existing content; it is not routing, persistence or duplicated entity facts.

## Existing examples and verification

Use the SKILL's minimal state and existing contract's preview-context example,
not another preview authority. Run actual map/HTML checks and reject escaping or
missing artifacts and invalid bindings. Visually trace a principal route and
any materially different selection to its real destination/context; inspect
resize/labels/narrow scrolling and return behavior. Separate map validation,
actual click-through, durable save/reopen and installed-host support. A valid
hotspot marker or screenshot alone proves neither navigation nor persistence.
