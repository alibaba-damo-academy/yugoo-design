# frosted_prism — 棱镜雾光

Load AFTER picking this direction, BEFORE the visual style state is produced.

## Canonical token recipe

```json
{"colors":{"primary":"#6a4ad8","primaryLight":"#8c75e8","primaryDark":"#4a32a8","secondary":"#3aa8c4","accent":"#d878c8","background":"#0e0d1a","surface":"#19182a","text":"#f3f1fa","textSecondary":"#9e9bbb","border":"#2a2840"},"semantic_colors":{"success":"#34d399","warning":"#fbbf24","error":"#f87171","info":"#60a5fa"},"typography":{"headingFont":"Inter, \"PingFang SC\", system-ui, sans-serif","bodyFont":"Inter, \"PingFang SC\", system-ui, sans-serif","monoFont":"JetBrains Mono, ui-monospace, monospace","baseFontSize":"14px","headingWeight":"600","lineHeight":"1.55"},"components":{"borderRadius":"10px","shadowDepth":"medium","buttonStyle":"filled","inputStyle":"filled","cardStyle":"elevated"},"density":"comfortable"}
```

## Vocabulary

| Trait | Value |
|---|---|
| Hue anchors | Indigo 270°, cyan 200°, violet 290° accent — all on near-black |
| Color strategy | Restrained chrome + accent for status/charts |
| Typography | Geist / Inter — restrained sans, tabular numerals |
| Radius | 12px |
| Motion | Mid (5–6) — purposeful, never flashy |
| Density | High (6–8) — dashboards, data |
| Theme | Dark-mode-first |

**Concrete cues:** frosted-glass surfaces with `backdrop-filter: blur(16px)
saturate(140%)`; 1px inner border on glass
(`border: 1px solid oklch(95% 0.005 240 / 0.10)`); tabular numerals everywhere
(`font-variant-numeric: tabular-nums`); small chart components (sparklines,
dot grids, status pills); restrained chrome — most data has no card, just
grid + dividers; real metric values, never placeholder.

**Refuse on sight:** glassmorphism for decoration (only when functional,
naming a card boundary); festival-pop heat; serifs anywhere (this IS a
dashboard); light-mode variant.

**Tone:** focused, technical, terse. ("API calls: 47,283 · 99.4% success ·
p99 142ms")

## Finish standard

- Start with a near-black spatial hierarchy, then use glass only for a real
  boundary such as the active monitor, inspector, or contextual overlay.
- Keep the cyan-violet light source local and purposeful; a full-page gradient
  or glowing outline on every panel turns this direction into visual noise.
- Make one live datum, alert state, or technical decision the focal point.
  Dense information must still have a clear scan path and a quiet resting area.

## Typography implementation

Use the canonical local/system font stacks in the token recipe. Do not add remote font dependencies to the preview.

## Imagery

`generate_image` suffix (append to every prompt this session):

> , frosted glass surface, soft diffused light, cyan-violet gradient hint
> behind the subject, clean editorial product photography, 4k, no people,
> no text, no logos

`search_stock_image` query modifier:

> , clean modern interior, frosted glass surfaces, soft cool daylight,
> minimal scandinavian
