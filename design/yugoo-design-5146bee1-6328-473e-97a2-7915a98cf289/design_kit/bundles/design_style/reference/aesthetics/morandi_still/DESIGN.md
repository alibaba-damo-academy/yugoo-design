# morandi_still — 莫兰迪静物

Load AFTER picking this direction, BEFORE the visual style state is produced.

## Canonical token recipe

```json
{"colors":{"primary":"#8a9678","primaryLight":"#a8b298","primaryDark":"#646e58","secondary":"#b89878","accent":"#9a6f68","background":"#fbfaf5","surface":"#efece2","text":"#322d28","textSecondary":"#75695e","border":"#dad3c4"},"typography":{"headingFont":"\"Cormorant Garamond\", \"Source Han Serif SC\", Songti, Georgia, serif","bodyFont":"Inter, \"PingFang SC\", system-ui, sans-serif","monoFont":"JetBrains Mono, ui-monospace, monospace","baseFontSize":"15px","headingWeight":"500","lineHeight":"1.7"},"components":{"borderRadius":"12px","shadowDepth":"subtle","buttonStyle":"soft","inputStyle":"bordered","cardStyle":"flat"},"density":"spacious"}
```

## Vocabulary

| Trait | Value |
|---|---|
| Hue anchors | Sage 140°, terracotta 25°, cream-ink 60° (Morandi-low chroma 0.05–0.10) |
| Color strategy | Full palette (3 earth tones used deliberately) |
| Typography | Cormorant Garamond or Source Han Serif headlines; Instrument Sans body |
| Radius | 12px rounded but flat (not bouncy 24px) |
| Motion | Low–mid (3–5) — slow fades, gentle scrolls |
| Density | Medium (4–5) — comfortable, not cramped |

**Concrete cues:** earth-tone palette (sage success, terracotta warmth); paper
texture or subtle noise on surfaces (NOT on scrolling containers —
performance); hand-illustrated or watercolor SVG accents; soft shadows tinted
to surface hue (very low alpha); tactile product imagery (real photography,
plant-still-life mood); slow page rhythm — sections breathe.

**Refuse on sight:** high-saturation accents (chroma >0.15 anywhere); cool
slate or neon; festival-pop sticker chrome; sharp 4px radius (too crisp for
the mood).

**Tone:** gentle, slow, reflective. ("Take a breath. Try the practice when
you're ready.")

## Finish standard

- Make the tactile subject—ritual, object, reflection, or gentle next action—
  the composition's anchor; muted color without a focal point becomes washed out.
- Use one or two materially believable surface moments, such as paper, a real
  product image, or a soft illustrated accent. Do not scatter decorative plants
  and blobs across every section.
- Preserve tonal restraint with clear type contrast and generous breathing room.
  The result should feel calm and intentional, never merely beige and empty.

## Typography implementation

Use the canonical local/system font stacks in the token recipe. Do not add remote font dependencies to the preview.

## Imagery

`generate_image` suffix (append to every prompt this session):

> , muted Morandi color palette (dusty pink + sage + cream), painterly soft
> north light, still-life composition, matte chalky texture, 4k, no people,
> no text, no logos

`search_stock_image` query modifier:

> , muted Morandi palette dusty pink sage cream, painterly soft north light,
> still-life composition, matte texture
