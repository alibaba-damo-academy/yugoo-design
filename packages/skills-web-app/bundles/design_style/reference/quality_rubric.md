# Visual quality rubric

Use after direction selection and before materializing the preview. Selection
reasoning and state schema live in `SKILL.md`; this file is only the craft floor.

## Hierarchy before decoration

- Make one product-specific interaction or content block unmistakable.
- Establish frame, navigation posture, primary action, and reading order before
  texture, imagery, or motion.
- Use few surface levels. Cards group real units; they do not manufacture every
  level of hierarchy.
- Vary spacing by relationship. Equal gaps everywhere flatten meaning.
- Responsive design preserves priority instead of squeezing desktop chrome.

## Color and typography

- Establish background, surface, text, secondary text, and borders before brand
  color. Reserve primary/accent for action, selection, focus, and real emphasis.
- Keep semantic states distinguishable and reinforce them with text or icons.
- Use credible Chinese and Latin font fallbacks. Do not declare remote fonts the
  preview cannot load.
- Long reading needs comfortable measure and line height; operational scanning
  needs stable alignment and controlled density.
- Create hierarchy with scale, weight, measure, and whitespace before color.

## Components and interaction

- Buttons, inputs, cards, chips, tabs, and navigation share radius, border,
  elevation, and density language.
- Keep one primary action per local decision. Show only relevant hover, focus,
  selected, disabled, loading, empty, and error states.
- Use visible focus and adequate hit targets. Motion explains state or continuity
  and respects reduced-motion preferences.
- Modals are for interruption or confirmation, not page structure.

## Product grounding

- Use confirmed roles, modules, actions, states, and plausible content.
- Never fabricate performance claims, user counts, percentages, testimonials,
  or urgency.
- Utility surfaces use precise copy; atmospheric copy belongs only on surfaces
  whose job is persuasion or experience.
- If the page can be relabelled into an unrelated product without changing its
  hierarchy, it is not finished.

## Icons and imagery

- Use one icon language: the bundled `assets/icons/` inline SVGs; never use
  emoji, bitmaps, or icon fonts as UI icons.
- Imagery is material when the product sells, curates, teaches, documents, or
  emotionally frames something visual. Dense work surfaces often need none.
- Generated/sourced images must land under `design_files/design_style/images/`,
  use the exact returned filename, and have meaningful alt text.
- Never force stock imagery onto a work surface. A neutral local placeholder is
  better than an irrelevant, broken, remote, or expiring image.

## Refuse on sight

- interchangeable sidebar + toolbar + equal card grid;
- purple/blue gradient as proof of “AI”, or gradient text for ordinary emphasis;
- rounded cards, thick borders, giant icons, or shadows on every surface;
- centered marketing hero for a task-oriented screen;
- competing typefaces/icon families, fake charts/metrics, generic startup copy;
- remote dependencies, broken paths, or animation without state meaning.

## Final fit questions

1. Which confirmed product fact chose this screen?
2. What is the focal interaction?
3. Which token relationships make hierarchy visible?
4. What would become misleading in a generic template?

If the answers could describe an unrelated product, refine the composition.
