---
version: alpha
name: "Loopline Delivery"
---

<!-- Generated from design_style.json. Update canonical state, not this projection. -->

## Overview

Clear delivery decisions

## brand

```json
{
  "name": "Loopline Delivery",
  "name_en": "Loopline Delivery",
  "tagline": "Clear evidence, explicit commitments",
  "mark_id": "decision",
  "mark_svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M4 12l5 5L20 6\"/></svg>"
}
```

## colors

```json
{
  "primary": "#245dd7",
  "background": "#f8fafc",
  "surface": "#ffffff",
  "text": "#1e293b",
  "muted": "#475569",
  "border": "#cbd5e1",
  "mutedSurface": "#edf2f7",
  "infoSurface": "#edf2ff",
  "warningSurface": "#fff6dd",
  "focus": "#f59e0b"
}
```

## semantic colors

```json
{
  "success": "#147d51",
  "warning": "#996800",
  "danger": "#b42318",
  "information": "#245dd7"
}
```

## typography

```json
{
  "bodyFont": "system-ui, sans-serif",
  "headingFont": "system-ui, sans-serif",
  "baseFontSize": "15px",
  "lineHeight": "1.6",
  "fontSizeXl": "21px"
}
```

## hierarchy

```json
{
  "page_title": "28px / 1.25",
  "section_title": "21px / 1.4",
  "body": "15px / 1.6"
}
```

## layout

```json
{
  "mode": "sidebar",
  "sidebar": {
    "position": "left",
    "style": "collapsible"
  },
  "content_width": "wide",
  "density": "comfortable"
}
```

## spacing

```json
{
  "base": "4px",
  "scale": [
    "4px",
    "8px",
    "12px",
    "16px",
    "24px",
    "32px"
  ]
}
```

## elevation

```json
{}
```

## components

```json
{
  "button": "Emphasize the main action, keep cancel and back neutral, and provide a real recovery action on failure.",
  "borderRadius": "4px",
  "shadowDepth": "subtle"
}
```

## component patterns

```json
{
  "feedback-row": {
    "description": "Feedback summary row",
    "anatomy": [
      "Stable ID, name, status and next action",
      "Body and entry to source evidence"
    ],
    "variants": [
      "Normal, needs information, confirmed"
    ],
    "states": [
      "Loading, empty, recoverable error, read-only"
    ]
  },
  "impact-note": {
    "description": "Impact explanation",
    "anatomy": [
      "Stable ID, name, status and next action",
      "Body and entry to source evidence"
    ],
    "variants": [
      "Normal, needs information, confirmed"
    ],
    "states": [
      "Loading, empty, recoverable error, read-only"
    ]
  },
  "decision-form": {
    "description": "Lead decision form",
    "anatomy": [
      "Stable ID, name, status and next action",
      "Body and entry to source evidence"
    ],
    "variants": [
      "Normal, needs information, confirmed"
    ],
    "states": [
      "Loading, empty, recoverable error, read-only"
    ]
  }
}
```

## iconography

```json
{
  "library": "Original line icons in this example",
  "view_box": "0 0 24 24",
  "stroke_width": "2",
  "size_sm": "16px",
  "size_md": "20px",
  "size_lg": "24px"
}
```

## icons

```json
{
  "inbox": {
    "label": "Feedback list",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 13h5l2 3h4l2-3h5\"/></svg>"
  },
  "decision": {
    "label": "Confirm decision",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M4 12l5 5L20 6\"/></svg>"
  }
}
```

## motion

```json
{
  "duration_fast": "150ms",
  "duration_normal": "250ms",
  "duration_slow": "400ms"
}
```

## Representative Screen

- Title: Clear delivery decisions
- Rationale: Shows a long explanation, missing-information feedback and a confirmation action.
- Implementation reference: design_style/preview.html

## Do's and Don'ts

- Consume the sibling `tokens.css`.
- Do not invent a competing palette or type scale.
