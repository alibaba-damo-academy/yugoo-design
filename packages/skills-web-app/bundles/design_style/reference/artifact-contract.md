# Design Style output contract

Shared by forward design and source reconstruction. The installed schema and validation define the state. This document defines artifact representation and file operations, not how to choose a new visual direction.

## Visual authority

`config.hierarchy` names reusable visual roles, not business priorities.
`config.component_patterns` records reusable anatomy, variants, and states;
it is a design contract, not a runtime component library or HTML template.
`config.iconography` records the chosen library and one coherent size/stroke
grammar, while `config.icons` maps stable semantic IDs to exact SVG markup.
When the SVG comes from this Bundle, retain its optional Bundle-relative
`asset` provenance such as `assets/icons/search.svg`; the JSON remains the
exact handoff authority and Page workers inline those bytes into standalone
artifacts. Neither SVG markup nor the library choice is emitted into CSS.
The JSON and generated `DESIGN.md` retain those decisions. `tokens.css` carries
only directly consumable values such as color, type, spacing, radius, icon
size, and stroke width; it never embeds SVG source or the icon-library choice.
If no brand mark is accepted, use the brand name as a text wordmark rather
than inventing a Page-local mark.

## State and projections

Use the following shape. Required groups for a completed proposal are marked
`REQUIRED`; optional fields are included only when they carry a real decision.
Example values and the listed aesthetic vocabulary illustrate representation;
they are not defaults or source facts. During restoration use the actual source
values and vocabulary, not this example's font sizes, icon library or layout.

```json
{
  "skill_name": "design_style",
  "epoch": 0,
  "config": {
    "theme": "REQUIRED: one-line direction label",
    "layout": {
      "mode": "sidebar | topbar | bottom-nav | dashboard | minimal",
      "sidebar": {"position": "left | right", "style": "fixed | collapsible"},
      "content_width": "narrow | medium | wide | full",
      "density": "compact | comfortable | spacious"
    },
    "colors": {
      "primary": "#RRGGBB", "primaryLight": "#RRGGBB",
      "primaryDark": "#RRGGBB", "secondary": "#RRGGBB",
      "accent": "#RRGGBB", "background": "#RRGGBB",
      "surface": "#RRGGBB", "text": "#RRGGBB",
      "textSecondary": "#RRGGBB", "border": "#RRGGBB"
    },
    "semantic_colors": {
      "success": "#RRGGBB", "warning": "#RRGGBB",
      "error": "#RRGGBB", "info": "#RRGGBB"
    },
    "typography": {
      "headingFont": "CSS font stack", "bodyFont": "CSS font stack",
      "monoFont": "CSS font stack", "baseFontSize": "14px",
      "headingWeight": "600", "lineHeight": "1.5",
      "fontSizeXs": "12px", "fontSizeSm": "13px",
      "fontSizeLg": "16px", "fontSizeXl": "20px", "fontSize2xl": "28px"
    },
    "hierarchy": {
      "page_title": "primary screen identity",
      "section_title": "major content grouping",
      "supporting_text": "secondary explanation"
    },
    "components": {
      "borderRadius": "8px", "shadowDepth": "none | subtle | medium | deep",
      "buttonStyle": "filled | outlined | soft",
      "inputStyle": "bordered | filled | underlined",
      "cardStyle": "flat | elevated"
    },
    "component_patterns": {
      "primary_navigation": {
        "description": "stable application navigation treatment",
        "anatomy": ["icon", "label"],
        "variants": ["default", "compact"],
        "states": ["default", "hover", "active", "focus"]
      }
    },
    "iconography": {
      "library": "bundled library name", "style": "outline",
      "view_box": "0 0 24 24", "stroke_width": "1.75",
      "linecap": "round", "linejoin": "round",
      "size_sm": "16px", "size_md": "20px", "size_lg": "24px"
    },
    "icons": {
      "navigation_search": {
        "label": "Search", "svg": "<svg ...>...</svg>",
        "asset": "assets/icons/search.svg"
      }
    },
    "preview_page": {
      "name": "REQUIRED: stable_snake_case_name",
      "title": "REQUIRED: user-facing title",
      "rationale": "REQUIRED: why this screen proves the direction",
      "html_file": null
    },
    "notes": "concise product-specific conclusion, not hidden reasoning",
    "aesthetic": {
      "vocabulary": "selected seed id or bespoke",
      "mood": "short phrase", "copy_register": "voice rule",
      "lighting_hints": "optional imagery guidance"
    },
    "motion": {
      "duration_fast": "150ms", "duration_normal": "300ms",
      "duration_slow": "500ms", "ease_standard": "cubic-bezier(...)"
    },
    "spacing": {"base": "4px", "scale": ["4px", "8px", "12px", "16px"]},
    "elevation": {"dropdown": 10, "sticky_nav": 20, "modal": 50, "tooltip": 70},
    "breakpoints": {"sm": "640px", "md": "768px", "lg": "1024px", "xl": "1280px"},
    "dark_mode": {"colors": {"background": "#RRGGBB"}},
    "brand": {"name": "", "name_en": "", "tagline": ""},
    "images": {
      "slot_name": {
        "source": "ai | pexels | iqs | external", "path": "images/exact-file.ext",
        "prompt": "", "url": null, "photo_id": null, "photographer": null,
        "photographer_url": null, "alt": "meaningful text",
        "width": null, "height": null, "avg_color": "#RRGGBB"
      }
    },
    "preview_pages": []
  }
}
```

For a text-only brand, omit both `brand.mark_id` and `brand.mark_svg`. For an
accepted SVG mark, supply both together: a stable `mark_id` and the exact
complete local `mark_svg` bytes. An existing raster mark uses `brand.logo_image`
instead; a missing SVG is not permission to replace its identity.

`colors`, `semantic_colors`, `typography`, `hierarchy`, `components`,
`component_patterns`, `iconography`, `layout`, and `preview_page` are REQUIRED
for a new completed proposal. Add only the semantic icon mappings actually
needed by current Style previews or Page evidence; do not build an exhaustive
catalog. `epoch` is preserved from
existing state. Preview HTML is a direct Bundle artifact, never an embedded
canonical JSON field. Use only project-relative `design_style/...` artifact pointers, never host
workspace prefixes or old flat paths.

After coherent tokens and the preview identity are chosen, write the complete
state whose `html_file` is null. Call `run_skill_script` twice with
`path: "design-style.mjs"`, `args` set to `["render-design-md"]` and
`["render-tokens-css"]`, `input_file: "design_style/design_style.json"`, and
`output_file` set to `design_style/DESIGN.md` and `design_style/tokens.css`
respectively. The Host writes both projections directly, so their bytes never
pass through model context. This is an ordinary live filesystem update for
panel polling, not a publication or Git boundary.
Before authoring, call `design_focus_artifact` with
`artifact_kind: "design_style_preview"`, `artifact_id` equal to
`preview_page.name`, and `artifact_file` equal to the exact
`design_style/preview_<name>.html` path, so panel activity binds to that one
artifact. Then author `design_style/preview_<name>.html` and update
`html_file` to that exact project-relative path in the same working copy. Run
`design_validate` against the working copy. Field-level validation errors are
authoritative; correct the named working-copy field or artifact and validate
again.

## Preview file

One complete HTML5 document at `design_style/preview_<name>.html`; its canonical reference is project-relative and accepted only after the actual file passes validation.

- In `<head>`, link `<link rel="stylesheet" href="./tokens.css">`.
- Consume at least five `var(--ds-*)` values and use them for canonical palette
  roles, font families, type hierarchy, radius, shadow, density, and content
  width. Route color, type, spacing, radius, and elevation through the emitted
  scale; only structural dimensions and positions remain local.
- Do not declare `--ds-*` in HTML and do not add token fallback values. Changes
  belong in canonical state; the platform regenerates `tokens.css`.
- Keep scripts/assets local. No CDN, expiring URL, fabricated metric, broken
  icon, or generic filler section.

## Original local images

An existing raster brand uses `config.brand.logo_image` with its project-relative `path`, `source: "external"` and meaningful `alt`; omit SVG-only `mark_id`/`mark_svg`. Other local images use `config.images`. Record actual scope in existing descriptions. Use prepared original bytes, not transcribed base64 or invented replacements. In preview HTML, use plain `img src` relative to that HTML for local PNG/JPEG/WebP. The panel embeds those bytes; CSS background assets, fonts and responsive picture sets are not automatically imported. Report material unsupported presentation.

## Landed-file validation

Immediately before publication, check the actual generated stylesheet with
`run_skill_script`, `path: "design-style.mjs"`,
`args: ["validate-tokens-file"]`, `input_file: "design_style/tokens.css"`,
and `input_context: {state: <current complete state>}`. This reads the landed
file, not an in-memory substitute. Repair mismatches by regenerating from the
current canonical JSON; preview validation alone does not check that file.
Then call `run_skill_script` with
`path: "design-style.mjs"`, `args: ["validate-preview-file"]`, `input_file`
equal to the preview HTML path, and `input_context` containing
the current `state` and exact `preview_file` path. It returns diagnostics only;
repair them, call `design_validate({outcome:"complete"})`,
then call `design_publish({action:"complete"})` only when both checks pass. The
Host completion gate independently rejects a `complete` whose
`config.preview_page.html_file` is null or empty, so the accepted preview ref is
required before the terminal publication settles; a milestone plan with a null
`html_file` stays an ordinary working-copy state, never a `complete` commit.
If the same diagnostic repeats without file/state progress, stop
editing and report the exact blocker; never restart the complete visual design.
Return a short summary of persisted output and material fixes.
