# honey_twilight — 暮光琥珀

Load AFTER picking this direction, BEFORE the visual style state is produced.

## Canonical token recipe

```json
{"colors":{"primary":"#d8466a","primaryLight":"#e87391","primaryDark":"#a82c4f","secondary":"#e88a3a","accent":"#9468d8","background":"#fdf8f0","surface":"#f8edd8","text":"#3a1f1f","textSecondary":"#7a4a3a","border":"#e8d4b0"},"typography":{"headingFont":"\"Playfair Display\", \"Source Han Serif SC\", Songti, serif","bodyFont":"Inter, \"PingFang SC\", system-ui, sans-serif","monoFont":"JetBrains Mono, ui-monospace, monospace","baseFontSize":"15px","headingWeight":"600","lineHeight":"1.6"},"components":{"borderRadius":"16px","shadowDepth":"subtle","buttonStyle":"filled","inputStyle":"underlined","cardStyle":"elevated"},"density":"spacious"}
```

## Vocabulary

| Trait | Value |
|---|---|
| Hue anchors | Amber 70°, rose 15°, lavender 295° accent |
| Color strategy | Full palette (3 named hues used deliberately) |
| Typography | Cormorant Garamond / Source Han Serif headlines; Instrument Sans body |
| Radius | 14px, generous |
| Motion | Mid (5–6) — slow page reveals, gradient transitions |
| Density | Low (3–4) — generous, premium feel |

**Concrete cues:** serif display headline (optional drop cap on first
paragraph); generous margins (content max-width ~1080px, whitespace around
blocks); gradient hero amber → rose (NEVER amber → violet — that's lila);
1–2 high-quality photos with subtle frame chrome; pull quotes or oversized
typography moments; refined CTAs (secondary always present alongside primary).

**Refuse on sight:** festival-pop sticker chrome; dashboard-card grid layouts;
monospace anywhere except metadata.

**Tone:** warm, slow, exquisite. Complete sentences. Slight aspirational lift.

## Finish standard

- Compose with one generous visual or typographic moment, then allow the next
  section to breathe; do not turn every block into a rounded warm card.
- Let amber, rose, and lavender have distinct roles in the composition. A
  gradient is a background atmosphere or transition, never the entire design.
- Use image crop, serif scale, and measured negative space to create luxury.
  If the page still reads as a generic lifestyle landing template, simplify the
  chrome and refine the composition rather than adding more color.

## Typography implementation

Use the canonical local/system font stacks in the token recipe. Do not add remote font dependencies to the preview.

## Imagery

`generate_image` suffix (append to every prompt this session):

> , warm honey golden-hour light, raw linen surface, soft long shadows,
> lifestyle still-life photography, 4k, no people, no text, no logos

`search_stock_image` query modifier:

> , golden-hour light, raw linen and warm wood, slow-living aesthetic,
> soft long shadows
