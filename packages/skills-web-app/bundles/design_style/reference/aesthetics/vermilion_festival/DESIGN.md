# vermilion_festival — 节庆朱橙

Load AFTER picking this direction, BEFORE the visual style state is produced.

## Canonical token recipe

```json
{"colors":{"primary":"#e85a2c","primaryLight":"#f4845a","primaryDark":"#b8421e","secondary":"#7a3aa8","accent":"#f5c542","background":"#fffaf3","surface":"#fff2e3","text":"#1f1410","textSecondary":"#7a5a4a","border":"#f5d4b8"},"typography":{"headingFont":"PingFang SC, Inter, system-ui, sans-serif","bodyFont":"PingFang SC, Inter, system-ui, sans-serif","monoFont":"JetBrains Mono, ui-monospace, monospace","baseFontSize":"14px","headingWeight":"700","lineHeight":"1.5"},"components":{"borderRadius":"12px","shadowDepth":"medium","buttonStyle":"filled","inputStyle":"bordered","cardStyle":"elevated"},"density":"comfortable"}
```

## Vocabulary

| Trait | Value |
|---|---|
| Hue anchors | Vermilion 30–40°, violet accent 290°, warm cream surface 70° |
| Color strategy | Committed (vermilion 30–60% of surface) |
| Typography | MiSans / PingFang SC for CJK; Inter for Latin. Heavy weights for prices. |
| Radius | 12px friendly, pill chips, large card radius 16px |
| Motion | Mid-high (6–8) — countdown timers, sticker badges, marquee notices |
| Density | Medium-low (4–5) — mobile-first, breathing room around products |

**Concrete cues (always include some):** big price numerals (`text-2xl`+
weight 700) with strikethrough original price; hand-drawn / sticker-style
badges ("已开 247 单", "限时 30 分", "包邮"); ≥1 high-quality intentional
product photo; social proof block ("347 人正在拼团"); sticky bottom CTA bar
(mobile); countdown timer; expressive type contrast (display 700 + body 400).

**Refuse on sight:** editorial restraint / narrow margin columns; monospace
numerals (use proportional display weight); frosted-glass surfaces, cool slate
neutrals; cards-everywhere with uniform spacing.

**Tone:** warm, energetic, slight informality, urgency cues. Exclamation marks
OK in moderation. ("还差 3 人成团，赶紧开团抢！")

## Finish standard

- Centre one real product, offer, group-buy state, or time-bound choice before
  adding social proof and stickers. Urgency without a clear object is noise.
- Use vermilion as a confident mass with warm cream breathing room; reserve
  violet and gold for precise supporting roles instead of scattering all hues.
- Build a mobile reading rhythm from product proof to price to action. Stickers,
  countdowns, and badges must reinforce that path, never become a uniform wall
  of decoration.

## Typography implementation

Use the canonical local/system font stacks in the token recipe. Do not add remote font dependencies to the preview.

## Imagery

`generate_image` suffix (append to every prompt this session):

> , warm vermilion accent, subtle Chinese 微细 pattern hint in background,
> bright clear product photography, slight gold leaf texture, 4k, no people,
> no text, no logos

`search_stock_image` query modifier:

> , warm vermilion red accent, festive Chinese visual hints, bright clean
> lighting, modern eastern aesthetic
