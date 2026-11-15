# trust_light — 高信任浅色界面

Use for finance, healthcare, education records, identity, account, or public
service products where reassurance, form clarity, and error prevention are
more important than novelty.

## Canonical token recipe

```json
{
  "colors": {
    "primary": "#0F6CBD", "primaryLight": "#EAF3FB", "primaryDark": "#0B4F8A",
    "secondary": "#0F766E", "accent": "#0F6CBD",
    "background": "#F6F9FC", "surface": "#FFFFFF",
    "text": "#102A43", "textSecondary": "#486581", "border": "#D9E2EC"
  },
  "semantic_colors": {
    "success": "#107C10", "warning": "#8A4B00", "error": "#B42318", "info": "#0F6CBD"
  },
  "typography": {
    "headingFont": "Inter, \"PingFang SC\", system-ui, sans-serif",
    "bodyFont": "Inter, \"PingFang SC\", system-ui, sans-serif",
    "monoFont": "JetBrains Mono, ui-monospace, monospace",
    "baseFontSize": "15px", "headingWeight": "600", "lineHeight": "1.6"
  },
  "components": {
    "borderRadius": "8px", "shadowDepth": "subtle",
    "buttonStyle": "filled", "inputStyle": "bordered", "cardStyle": "flat"
  },
  "density": "comfortable"
}
```

## Vocabulary

- Make labels, amounts, status, validation, consent, and irreversible actions
  explicit. Do not use colour as the only carrier of meaning.
- Blue and muted teal signal calm confidence; reserve saturated red and amber
  for real risk, errors, and warnings.
- Use straightforward layouts, stable actions, and modest motion. Familiarity is
  a usability quality here, not a lack of craft.

## Finish standard

- Make the consequential item unmistakable: a balance, identity step, record,
  consent, or review decision must be readable before secondary navigation.
- Build reassurance through a calm canvas, a bounded form or record plane,
  clear label-to-value alignment, and visible confirmation/error states. Do not
  decorate a sensitive task with generic illustrations or promotional cards.
- Let spacing slow the eye at risk points and keep irreversible actions
  deliberately separated. A plain layout is refined only when its hierarchy
  makes the next safe action obvious.

## Imagery

Avoid decorative lifestyle imagery around sensitive forms or account data. If a
task needs real-world context, use a relevant, verified scenario image sparingly
and never substitute it for clear labels or status evidence.
