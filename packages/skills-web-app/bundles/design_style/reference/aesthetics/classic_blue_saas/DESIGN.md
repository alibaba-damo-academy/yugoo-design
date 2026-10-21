# classic_blue_saas — 经典白蓝 SaaS

Use for ordinary B2B products, internal management systems, collaboration
software, and account-oriented applications when the task gives no stronger
brand or atmosphere signal. It is a deliberate light interface: hierarchy,
forms, selected state, and data legibility matter more than visual spectacle.

## Canonical token recipe

```json
{
  "colors": {
    "primary": "#2563EB", "primaryLight": "#EEF4FF", "primaryDark": "#1D4ED8",
    "secondary": "#667085", "accent": "#2563EB",
    "background": "#F8FAFC", "surface": "#FFFFFF",
    "text": "#182230", "textSecondary": "#667085", "border": "#E4E7EC"
  },
  "semantic_colors": {
    "success": "#067647", "warning": "#B54708", "error": "#B42318", "info": "#2563EB"
  },
  "typography": {
    "headingFont": "Inter, \"PingFang SC\", system-ui, sans-serif",
    "bodyFont": "Inter, \"PingFang SC\", system-ui, sans-serif",
    "monoFont": "JetBrains Mono, ui-monospace, monospace",
    "baseFontSize": "14px", "headingWeight": "600", "lineHeight": "1.5"
  },
  "components": {
    "borderRadius": "10px", "shadowDepth": "subtle",
    "buttonStyle": "filled", "inputStyle": "bordered", "cardStyle": "flat"
  },
  "density": "comfortable"
}
```

## Vocabulary

- White and cool-gray surfaces establish hierarchy; blue is reserved for primary
  actions, links, keyboard focus, selected navigation, and informative states.
- Prefer borders and spacing before shadows. A card must group a real unit of
  work, not turn every text block into a floating tile.
- Use compact, unsurprising interaction feedback: hover, selected, focus, and
  validation states are more valuable than decorative motion.
- Start with a sidebar or topbar only when the confirmed product navigation
  needs it; the colour direction does not prescribe the page skeleton.

## Craft bar — familiar, never generic

Classic white-and-blue is a product foundation, not an unfinished admin
template. Build its quality from restraint:

1. **Name the work clearly.** The page must show a real workspace, object, or
   decision from the confirmed product. Generic navigation labels and a stock
   task table are not a substitute for product language.
2. **Make one work action visually inevitable.** Establish a primary object or
   view, then one focal interaction such as a pending approval, a saved filter,
   a customer record state, or a meaningful form decision. The blue action is
   the consequence of that hierarchy, not the decoration that creates it.
3. **Use quiet depth.** Separate page canvas, durable chrome, and the active
   work surface with neutral contrast, borders, and spacing before adding
   shadows. Let type scale, metadata alignment, and selected states create
   rhythm; do not wrap each region in a card.
4. **Spend blue carefully.** Keep it to the active navigation/view, primary
   action, focus ring, links, and genuine information states. A fully blue
   toolbar or repeated pale-blue boxes makes a restrained interface feel like a
   default template instead of a deliberate product.
5. **Polish the light system.** Use a faint cool-gray canvas, a white work
   plane with a hairline border and restrained ambient elevation, then reserve
   dense dividers for information inside it. Establish a clear 20–28px outer
   rhythm before adding any card. Controls should share a 10px radius and
   precise vertical alignment; not every grouping needs its own container.

After rendering, the screenshot must still look calm and efficient while making
the product's purpose legible at a glance. If it could be relabelled into an
unrelated SaaS without changing its hierarchy, refine the composition rather
than changing the palette.

## Imagery

Do not add a hero image to a work surface merely to make it look finished. If a
real entity is central to the page (product, property, document cover), use a
real generated or sourced image in that entity’s slot and persist it in
`config.images`. Otherwise the interface, data, and controls are the preview.
