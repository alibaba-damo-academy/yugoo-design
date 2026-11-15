# studio_noir — 深夜舞台

Load AFTER picking this direction, BEFORE the visual style state is produced.

## Canonical token recipe

```json
{"colors":{"primary":"#ff4470","primaryLight":"#ff6e90","primaryDark":"#cc2e54","secondary":"#3acccc","accent":"#ffd84a","background":"#0a0a10","surface":"#15151f","text":"#f5f5f8","textSecondary":"#9898a8","border":"#262633"},"semantic_colors":{"success":"#4ade80","warning":"#fbbf24","error":"#fb7185","info":"#60a5fa"},"typography":{"headingFont":"Inter, \"PingFang SC\", system-ui, sans-serif","bodyFont":"Inter, \"PingFang SC\", system-ui, sans-serif","monoFont":"JetBrains Mono, ui-monospace, monospace","baseFontSize":"14px","headingWeight":"700","lineHeight":"1.5"},"components":{"borderRadius":"8px","shadowDepth":"deep","buttonStyle":"filled","inputStyle":"filled","cardStyle":"elevated"},"density":"comfortable"}
```

## Vocabulary

| Trait | Value |
|---|---|
| Hue anchors | Coral 30° OR cyan 195° (pick ONE), near-black bg with cool tint 270° |
| Color strategy | Restrained (near-black + tinted neutrals + ONE accent ≤10%) |
| Typography | Geist / Satoshi / Inter — sans-bold for impact |
| Radius | 8px sharp |
| Motion | High (7–9) — perpetual cycles, bold reveals |
| Density | Medium (4–6) — performance feels alive |
| Theme | Dark-mode-first |

**Concrete cues:** dark surface OKLCH ~14% L tinted cool (never pure black);
ONE saturated accent — coral OR cyan, never both ("AI cool" slop); bold sans
display (text-2xl+ weight 700); live/playback chrome (waveform, scrubber,
status indicator); a perpetual element somewhere (pulsing record dot, kinetic
marquee, typewriter); high type contrast (display 700 + body 450).

**Refuse on sight:** outer glows / neon shadows (the "AI cool" reflex);
purple/blue gradient anywhere; both coral AND cyan as accents; light-mode
variant — pick a different vocabulary if light is needed.

**Tone:** charged, confident, often single phrases. ("The mix is ready."
"Drop one tonight.")

## Finish standard

- Treat the page as a stage with one performance surface—playback, creation, or
  release—not as a black admin dashboard with neon accents.
- Let the single accent direct attention to a live state or decisive action;
  the surrounding black and charcoal must remain quiet enough for it to work.
- Use strong type scale, cadence, and one purposeful kinetic detail to create
  energy. Do not compensate for weak hierarchy with glows, gradients, or more
  animated widgets.

## Typography implementation

Use the canonical local/system font stacks in the token recipe. Do not add remote font dependencies to the preview.

## Imagery

`generate_image` suffix (append to every prompt this session):

> , studio strobe lighting, dark seamless backdrop, rim light from right,
> hint of warm coral specular highlight, product photography, 4k, no people,
> no text, no logos

`search_stock_image` query modifier:

> , dim moody lighting, dark wood and leather, warm tungsten, jazz lounge or
> recording studio aesthetic
