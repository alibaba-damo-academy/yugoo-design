---
name: whiteboard
description: Draw and revise a topic-based freeform whiteboard with the user. Use text, shapes and connectors to explore or explain ideas; do not substitute a sketch for an explicitly requested formal BPMN, page prototype or other Bundle output.
---

# Freeform whiteboards

For canvas generation or revision, read [the canvas guide](reference/canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

One topic is one editable board. The user and Agent edit the same scene file;
there is no separate AI graph, screenshot authority or server-owned whiteboard.
Choose the simplest arrangement that communicates the user's idea. Preserve
uncertainties as uncertainties rather than inventing confirmed product facts.

Read [reference/artifact-contract.md](reference/artifact-contract.md) before
writing. Inspect the existing index and relevant scenes first. Preserve topic,
element and binding IDs, unaffected positions, text, styling and image refs.
A rename changes the title, not the identity or artifact path. A local revision
does not authorize clearing or redrawing the entire scene. Read current files
again before replacing an artifact that may have been edited meanwhile.

The Producer draws directly using ordinary file tools. No special whiteboard
tool, mandatory Worker, external drawing service or new runtime is required.

Before creating a diagram or substantially rearranging one, read
[reference/drawing-method.md](reference/drawing-method.md). Choose a visual
structure from the relationships the user wants to understand, not from the
available shapes. Briefly state the intended reading order and scope, then draw;
do not add a confirmation gate for routine visual choices. For a local edit,
retain the established visual structure unless the requested change needs more.
Ask only when a missing decision materially changes meaning; otherwise show an
editable draft with uncertainty visible, without inventing facts to fill a layout.

Read [reference/geometry.md](reference/geometry.md) when creating or changing
text, containers or connectors. Derive related coordinates from shared anchors;
do not guess each field independently. Use ordinary code/arithmetic if helpful,
but persist only the native scene, not a second diagram model or generator state.

Who generates validates and repairs: run the Bundle's `scripts/validate.mjs`
against the Design Files directory after writing scene files and the index.
The script checks representation, references and ownership, not diagram meaning
or aesthetics. Also perform the geometry and reading-order checks in the two
references. With available browser/preview tools, inspect the rendered board at
overview and readable zoom, repair problems, and inspect again. A valid JSON
result is not visual acceptance. Without preview access, explicitly report that
visual review was unavailable; do not claim the drawing looks correct. Use the ordinary
host save/publication lifecycle; do not introduce a whiteboard-specific path.

Remove a topic only when requested. Remove its index entry and order member;
do not delete unrelated scene/image files or garbage-collect shared attachments.
Unreferenced old files can remain recoverable in history. Canvas pan, zoom,
selection and editing-tool state are not durable design facts.
