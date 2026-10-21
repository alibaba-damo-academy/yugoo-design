# Icon catalog

20 inline-SVG icons in Lucide style (hairline 1.5 stroke, 24×24 viewBox). All use `stroke="currentColor"` so they inherit the surrounding text color — no CSS recolor needed.

## How to use

Copy-paste the SVG content into your HTML. Set `width`/`height` attributes on the `<svg>` to size it; set `color` on the parent (or the SVG itself) to recolor.

```html
<button class="cta">
  立即购买
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12"></line>
    <polyline points="12 5 19 12 12 19"></polyline>
  </svg>
</button>
```

## Inventory

| Category | Icons |
|---|---|
| Navigation | `chevron-right`, `chevron-down`, `arrow-right`, `arrow-up-right`, `x-close`, `menu` |
| Audio controls | `play`, `pause`, `volume`, `music-note`, `headphones` |
| Status | `check`, `info`, `alert`, `dot` |
| Social / contact | `share`, `external-link`, `mail`, `map-pin` |
| Action | `search` |

## Adding new icons

If a project genuinely needs an icon outside this catalog, hand-roll an SVG that matches the style:
- 24×24 viewBox
- `stroke-width="1.5"` (NOT 2.0; NOT mixed)
- `stroke-linecap="round"` + `stroke-linejoin="round"`
- `fill="none"` on the `<svg>` root
- `stroke="currentColor"` so it inherits color

Don't use emojis as icons. Don't use bitmap images for UI icons. Don't mix stroke widths.

## Attribution

Icon paths derived from [Lucide](https://lucide.dev/) (MIT License). Hand-redrawn to match the pilot skill's voice; not a verbatim port.
