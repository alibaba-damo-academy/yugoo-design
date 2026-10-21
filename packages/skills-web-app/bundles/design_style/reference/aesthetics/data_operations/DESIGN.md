# data_operations — 数据运营界面

Use for analytics, monitoring, operations, inventory, support, and other
decision surfaces where people scan dense information repeatedly.

## Canonical token recipe

```json
{
  "colors": {
    "primary": "#2563EB", "primaryLight": "#EEF4FF", "primaryDark": "#1D4ED8",
    "secondary": "#667085", "accent": "#2563EB",
    "background": "#F7F8FC", "surface": "#FFFFFF",
    "text": "#182230", "textSecondary": "#667085", "border": "#E4E7EC"
  },
  "semantic_colors": {
    "success": "#067647", "warning": "#B54708", "error": "#B42318", "info": "#2563EB"
  },
  "typography": {
    "headingFont": "Inter, \"PingFang SC\", system-ui, sans-serif",
    "bodyFont": "Inter, \"PingFang SC\", system-ui, sans-serif",
    "monoFont": "JetBrains Mono, ui-monospace, monospace",
    "baseFontSize": "14px", "headingWeight": "600", "lineHeight": "1.45"
  },
  "components": {
    "borderRadius": "10px", "shadowDepth": "subtle",
    "buttonStyle": "filled", "inputStyle": "bordered", "cardStyle": "flat"
  },
  "density": "compact"
}
```

## Vocabulary

- Tables, filters, trend charts, status labels, and numeric alignment come
  before decorative panels. Use dividers and layers instead of card grids.
- Use tabular numerals for repeated measures. Give semantic states text/icon
  reinforcement as well as colour.
- High density does not mean small unreadable text; preserve a clear focus ring,
  row affordance, and responsive escape route for narrow screens.

## Light workspace composition

Make the default data surface feel considered rather than merely utilitarian:

- Let the faint blue-gray canvas sit behind durable navigation and one primary
  white work surface. On wide screens, give that surface a 20–28px outer gutter,
  a 10–12px radius, a hairline border, and only a soft ambient shadow. This is
  depth through separation, not a dashboard made of cards.
- Build the page in three readings: a quiet workspace identity, a compact
  context row (view name, record count, saved filter or group), then the table
  itself. Avoid a full-width toolbar whose controls all have equal weight.
- Give tables a calm header tint, 44–48px row rhythm, generous horizontal cell
  padding, and aligned numeric/date columns. A selected row or active view may
  use the pale blue fill; ordinary rows remain white with hover revealed by
  subtle contrast rather than a heavy blue wash.
- Use 10px controls and chips with measured padding, but do not round table
  cells, every toolbar group, or every empty region. The rounded work surface
  frames the task; the data inside stays precise.
- Make the primary action small but unmistakable. Secondary actions should read
  as text, icons, or quiet bordered controls, so blue has visual authority when
  it appears.

## Craft bar — restrained, not generic

The light neutral + blue-action system is a foundation, not a finished design.
Do not stop at a generic left sidebar, toolbar, and undifferentiated table.
Before materialising a data-workspace preview, establish:

1. **A recognisable workspace hierarchy** — product/workspace identity, a
   meaningful current view, and a clear distinction between durable navigation
   and the data surface. Use the actual product/module language from the
   established design instead of generic project-management copy.
2. **A data-specific interaction focal point** — for example, an active view
   chip, selected cell/row, grouped records, field-type indicators, a saved
   filter, or a compact summary. It should show why this is a working tool, not
   a static spreadsheet screenshot.
3. **Deliberate rhythm inside restraint** — at least three neutral surface
   levels, a purposeful density scale, column alignment that reflects data
   types, and one carefully controlled emphasis state. Blue may remain scarce;
   hierarchy, spacing, type scale, and semantic colour must carry the craft.
4. **Refined, not sterile** — the page should have a calm outer canvas, a
   precisely bounded work plane, and a readable table rhythm. Flatness is valid
   inside the data grid; making the entire viewport a single hard-edged white
   rectangle is not.

For Airtable-like products specifically, demonstrate a real base/table/view
relationship and at least one schema-aware affordance (field icon, record
state, grouping, or view control). Avoid inventing a dashboard or reusing a
stock task table when the product has not established that model.

## Imagery

Operations previews normally need no decorative imagery. Real asset thumbnails,
maps, product images, or incident evidence are appropriate only when they are
actual decision inputs and must be persisted in `config.images`.
