---
version: alpha
name: "回环交付"
---

<!-- Generated from design_style.json. Update canonical state, not this projection. -->

## Overview

清晰的交付判断

## brand

```json
{
  "name": "回环交付",
  "name_en": "Loopline Delivery",
  "tagline": "依据清楚，承诺明确",
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
  "button": "主操作清晰，取消和返回保持中性；错误提供实际恢复入口。",
  "borderRadius": "4px",
  "shadowDepth": "subtle"
}
```

## component patterns

```json
{
  "feedback-row": {
    "description": "反馈摘要行",
    "anatomy": [
      "稳定编号、名称、状态与下一步",
      "正文与原始依据入口"
    ],
    "variants": [
      "普通、需要补充、已确认"
    ],
    "states": [
      "加载、空内容、失败可重试、只读"
    ]
  },
  "impact-note": {
    "description": "影响说明",
    "anatomy": [
      "稳定编号、名称、状态与下一步",
      "正文与原始依据入口"
    ],
    "variants": [
      "普通、需要补充、已确认"
    ],
    "states": [
      "加载、空内容、失败可重试、只读"
    ]
  },
  "decision-form": {
    "description": "负责人决定表单",
    "anatomy": [
      "稳定编号、名称、状态与下一步",
      "正文与原始依据入口"
    ],
    "variants": [
      "普通、需要补充、已确认"
    ],
    "states": [
      "加载、空内容、失败可重试、只读"
    ]
  }
}
```

## iconography

```json
{
  "library": "本示例自绘线性图标",
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
    "label": "反馈列表",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 13h5l2 3h4l2-3h5\"/></svg>"
  },
  "decision": {
    "label": "确认决定",
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

- Title: 清晰的交付判断
- Rationale: 同时呈现长说明、待补充提示和确认动作。
- Implementation reference: design_style/preview.html

## Do's and Don'ts

- Consume the sibling `tokens.css`.
- Do not invent a competing palette or type scale.
