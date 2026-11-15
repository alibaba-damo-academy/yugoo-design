# Native editable whiteboard

Shared design/reconstruction reading entry. [The file contract](artifact-contract.md)
owns index, scene, image-reference and validation format.
[The drawing method](drawing-method.md) owns composition/reading order, and
[native geometry](geometry.md) owns text sizing, coordinates, endpoints and reciprocal bindings.
Preserve these specialist resources in place; this entry does not replace them.

## Facts and drawing semantics

`whiteboard/whiteboard.json` is the index; each exact `whiteboard/boards/<id>.json`
is its editable Excalidraw scene authority. One topic is one board. Distinguish
user statements, proposals and uncertainty. Shapes/notes/connectors explain ideas,
not automatically canonical business relations or approved policy. Reconstruction
preserves original meaning, native IDs/geometry and relevant supplied styling.

## Composition, ports, routing and unknowns

Choose a reading arrangement for the relationships, not a compulsory flowchart.
Retain unaffected positions and native geometry. Follow `geometry.md` for actual
text/container bounds and arrow points/bindings; they are native scene data,
not the view-only coordinates of a domain graph. Native attach-point spacing
may differ from the AI constellation's one-midpoint rule. Keep corridors and
labels clear without shrinking all text or removing requested ideas. Unfamiliar
element formats need real rendering review; structural validity alone does not
establish correct geometry. Missing image bytes never erase their references.

## Interaction, saving and examples

The shared `canvas_workspace`/native editor reads and edits that same scene.
Keep image bytes in attachments, never base64 in index/scene; retained deleted
element references protect undo. Index and changed scene/images use the existing
atomic save/publication path. Pan/zoom/selection/tool are local view state.
Preserve native editable elements, not a flattened screenshot or second graph.
Use the existing file/geometry examples. Run the Bundle scene validator and
check real endpoints, reciprocal bindings, long CJK labels, reading order,
missing images, resize and a local edit/undo where supported. Report structure,
visual review and durable save/reopen separately. Without a preview, disclose
that visual review is unverified; do not install a new runtime to claim success.
