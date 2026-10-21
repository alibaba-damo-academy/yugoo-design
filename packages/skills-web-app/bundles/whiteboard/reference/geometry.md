# Native scene geometry

The scene is the editable authority. A structurally valid element can still have
incorrect geometry. Resolve geometry before serialization and check it after
changes; the Bundle validator does not measure fonts or route connectors.

## Text and containers

Use the actual text, font size and line height to plan the box, not a guessed
height copied from another label. With explicit line breaks, a useful minimum is
`lineCount * fontSize * lineHeight`; wrapping may require more. Add interior
padding to container dimensions. Exact width depends on font metrics, including
CJK and fallback fonts; character counts alone are not a reliable measurement.
Inspect rendering when possible. Without measurement, leave conservative room
and mark visual review as unverified.

Keep `text` and `originalText` consistent when changing content. For container
text, set `containerId` and the container's matching `boundElements` text entry.
Respect native alignment, wrapping and auto-resize behavior; do not assume
`autoResize` will repair arbitrary stale dimensions during every load.
Diamonds and ellipses have less usable label space than their bounding rectangle.

Example: 10 explicit lines at font size 20 and line height 1.25 need about 250
units of text height before padding. A 160-high card cannot accommodate that by
declaring the text height to be 140. Shorten, wrap/reflow with adequate space, or
separate the explanation; do not falsify its dimensions.

## Connectors: intent and coordinates must agree

For an unrotated native line/arrow, points are relative to the element origin:
`absolutePoint = [element.x + point[0], element.y + point[1]]`.
Derive points by subtracting the chosen origin from intended absolute anchors.
Do not confuse an end coordinate with a displacement. For rotated or elbowed
native elements, retain their format-specific geometry; inspect the native
implementation/rendering before authoring unfamiliar fields.

For a new unrotated polyline, dimensions follow the point extents:
`width = max(point.x) - min(point.x)` and similarly for height. Negative relative
coordinates are valid; they do not mean the corresponding dimension is negative.

A worked construction (no special tool required):

```js
// Source right-edge anchor and destination left-edge anchor.
const source = { x: 80, y: 160, width: 200, height: 100 }
const target = { x: 440, y: 360, width: 200, height: 100 }
const start = [source.x + source.width + 8, source.y + source.height / 2]
const end = [target.x - 8, target.y + target.height / 2]
const corridorX = (start[0] + end[0]) / 2
const absolute = [start, [corridorX, start[1]], [corridorX, end[1]], end]
const points = absolute.map(([x, y]) => [x - start[0], y - start[1]])
// x/y = start; points = [[0,0],[72,0],[72,200],[144,200]].
// width = 144; height = 200. Supply the remaining native arrow fields.
```

Choose a corridor that is actually empty, not always the midpoint. Straight lines
are useful for aligned neighbors; bent routes often clarify returns and dense
relationships. Diagonals are allowed when they improve the sketch. Avoid running
through unrelated shapes or text. Separate shared-edge attach points so arrows
remain distinguishable. Keep connector labels off the stroke and nearby nodes.

Bindings encode which objects connect; they are not a substitute for coordinates.
The first/last absolute points must be near the intended source/target boundaries
with the chosen gap. Set `startBinding`/`endBinding` and reciprocal arrow entries
on the target shapes consistently. Arrowheads must indicate the intended direction.
On moving or resizing a bound shape, also re-evaluate affected connector geometry;
do not assume a file load automatically reroutes it.

## Pre-publication checks

- Calculate absolute endpoints of changed arrows. Compare to their bound shapes,
  not just to whether those IDs exist. Check all bends as well as endpoints.
- Compare explicit text line height to available space; inspect wrapping, fallback
  fonts and shaped containers in a preview where available.
- Check route corridors, labels and any intentional overlap at readable zoom.
- Run the existing structural validator, then visually inspect and repair with
  available preview tools. Neither check replaces the other. If preview is not
  available, report that limitation rather than installing a new runtime or
  claiming aesthetic validation.
