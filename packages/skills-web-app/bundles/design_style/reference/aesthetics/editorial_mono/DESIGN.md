# editorial_mono — 画刊单色

Load AFTER picking this direction, BEFORE the visual style state is produced.

## Canonical token recipe

```json
{"colors":{"primary":"#1a1a1a","primaryLight":"#3a3a3a","primaryDark":"#000000","secondary":"#6a6a6a","accent":"#c8472b","background":"#fafaf7","surface":"#f3f1ec","text":"#0a0a0a","textSecondary":"#6a6a6a","border":"#e0ddd5"},"typography":{"headingFont":"\"Source Serif Pro\", \"Source Han Serif SC\", Songti, Georgia, serif","bodyFont":"Inter, \"PingFang SC\", system-ui, sans-serif","monoFont":"JetBrains Mono, ui-monospace, monospace","baseFontSize":"15px","headingWeight":"600","lineHeight":"1.7"},"components":{"borderRadius":"4px","shadowDepth":"subtle","buttonStyle":"outlined","inputStyle":"underlined","cardStyle":"flat"},"density":"spacious"}
```

## Vocabulary

| Trait | Value |
|---|---|
| Hue anchors | Warm paper 60–80°, ink 50°, muted brick accent 25° |
| Color strategy | Restrained (one accent ≤10%) |
| Typography | Cormorant Garamond / Playfair / Source Han Serif — serif headlines |
| Radius | 4px sharp |
| Motion | Low (2–4) — text-wrap balance, subtle scroll fades |
| Density | Low–medium (3–5) — generous margin, narrow column |

**Concrete cues:** serif headline (display 2xl+ weight 500); narrow content
column (max-width ~900px, body within 65–75ch); drop cap on first paragraph;
hairline dividers between sections (1px low-contrast); author/date metadata in
mono or small caps (Latin only); sparse imagery (1 hero, maybe 1 inline figure).

**Refuse on sight:** dashboard-card grids; centered hero text over hero image
(editorial composition is left-aligned); neon accents, gradient text;
cards-everywhere.

**Tone:** considered, restrained, complete sentences. Periods, no exclamation
marks.

## Finish standard

- Let one editorial thesis, story, or artifact determine the lead composition;
  a serif font alone does not make a page editorial.
- Balance the narrow reading column with one deliberate image, pull quote, or
  metadata rail. Use paper, hairlines, and typographic contrast with precision,
  not ornamental clutter.
- Keep the page quiet enough for reading. If the layout can be rearranged into a
  generic marketing-card grid without losing meaning, restore the reading flow.

## Typography implementation

Use the canonical local/system font stacks in the token recipe. Do not add remote font dependencies to the preview.

## Imagery

`generate_image` suffix (append to every prompt this session):

> , warm bone paper background, soft natural overhead light, editorial
> magazine spread, slight film grain, 4k, no people, no text, no logos

`search_stock_image` query modifier:

> , warm bone paper, natural overhead light, considered editorial composition,
> slight grain
