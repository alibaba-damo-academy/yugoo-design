# Whiteboard file contract

For canvas generation or revision, read [the canvas guide](canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

`whiteboard/whiteboard.json` contains only the index:

```json
{"boards":{"idea":{"id":"idea","title":"Initial idea","artifact_file":"whiteboard/boards/idea.json"}},"board_order":["idea"]}
```

IDs contain ASCII letters, digits, `_` or `-` (1–128 characters). Index keys
equal IDs; the order contains every board exactly once. Empty indexes are valid.
Each board's exact scene path is `whiteboard/boards/<id>.json`.

Scenes contain `elements` (native Excalidraw elements, retaining their IDs and
all native geometry/bindings), `appState: {viewBackgroundColor: "#ffffff"}` and
`files` (image references). Never put scene elements or base64 in the index.
An empty scene is `{"elements":[],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}`.
Use rectangle, ellipse, diamond, line, arrow, text, freedraw, image or frame.
Embedded websites/iframes are not supported. Retain native element fields on
edits; do not convert the scene into a second domain graph. Selection/zoom/tool
state stays in the Panel. A minimal editable rectangle is:

```json
{"id":"box-1","type":"rectangle","x":80,"y":80,"width":220,"height":100,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"roundness":null,"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"boundElements":null,"updated":1,"link":null,"locked":false}
```

Text elements additionally carry text/originalText, fontSize, fontFamily (use 2
for the built-in sans-serif family), textAlign, verticalAlign, containerId,
autoResize and lineHeight. Lines/arrows carry points and their native bindings.
Bindings must refer to elements in the same scene. For coordinate construction,
text sizing and endpoint checks, use [geometry.md](geometry.md). Check native rendering when
authoring unfamiliar element kinds; structural validation is not visual proof.

Image elements refer to `fileId`. `files[fileId]` is
`{id, path, mimeType, created}`; path is
`whiteboard/attachments/<fileId>.png|jpg|webp` matching PNG/JPEG/WebP MIME.
Bytes are separate artifacts, never data URLs in persisted scene/index. Keep
references used by deleted elements too, so undo does not lose images.
The Panel hydrates these refs into native editor files and dehydrates uploads
on the existing atomic save. Missing images must not silently erase references.

Validation (Node only, no project/host imports or npm dependencies):

```sh
node /absolute/bundle/scripts/validate.mjs /absolute/project/design_files
```

The index schema/declarative validator is also used by the common host. The
scene format helper lives in this Bundle and remains its CLI authority. The
declarative Panel uses the shared native Excalidraw component; compatibility
tests check that its serialized scenes satisfy this Bundle helper. Core owns
only UI bindings, not another whiteboard domain model. No preview SVG or screenshot is
required to edit, save or reopen a board.
