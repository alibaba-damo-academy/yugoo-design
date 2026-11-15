# neutral_workspace — 中性效率工作台

Use for knowledge bases, writing tools, task planners, editors, and AI
workspaces where concentration and content scanning outweigh brand theatre.

## Canonical token recipe

```json
{
  "colors": {
    "primary": "#475569", "primaryLight": "#F1F5F9", "primaryDark": "#334155",
    "secondary": "#64748B", "accent": "#2563EB",
    "background": "#F8FAFC", "surface": "#FFFFFF",
    "text": "#0F172A", "textSecondary": "#64748B", "border": "#E2E8F0"
  },
  "semantic_colors": {
    "success": "#15803D", "warning": "#A16207", "error": "#B91C1C", "info": "#2563EB"
  },
  "typography": {
    "headingFont": "Inter, \"PingFang SC\", system-ui, sans-serif",
    "bodyFont": "Inter, \"PingFang SC\", system-ui, sans-serif",
    "monoFont": "JetBrains Mono, ui-monospace, monospace",
    "baseFontSize": "14px", "headingWeight": "600", "lineHeight": "1.6"
  },
  "components": {
    "borderRadius": "8px", "shadowDepth": "subtle",
    "buttonStyle": "filled", "inputStyle": "bordered", "cardStyle": "flat"
  },
  "density": "comfortable"
}
```

## Vocabulary

- Neutrals carry almost all chrome; one controlled blue accent identifies the
  current action without making every control compete for attention.
- Long-form text, tables, and editable panels need typography and spacing before
  decoration. Use visible focus, selection, and dirty-state cues.
- Keep motion at hover/focus/short panel-transition level unless the task asks
  for more.

## Finish standard

- Give the current document, draft, or decision a calm focal plane; navigation
  and utilities should frame it rather than compete with it.
- Establish hierarchy through a readable title/context row, intentional text
  measure or editor width, and a small number of durable dividers. Avoid a
  generic dashboard of equal cards when the work is writing or knowledge.
- Make neutral surfaces feel finished through alignment, type rhythm, selected
  states, and quiet elevation—not through a random blue accent on every control.

## Imagery

The workspace itself is normally the content. Use real imagery only for assets
the user genuinely reviews (document covers, media, profiles, catalog items),
and persist each selected image with meaningful alt text.
