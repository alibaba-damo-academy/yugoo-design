# Motion — durations, easing, perpetual interactions

Load when `动效强度 ≥ 7` (perpetual / scroll-driven choreography). Tier 1-6 motion is already covered by `quality_rubric.md` — don't load this file for it. Vanilla-JS-friendly — the prototype HTML has no Framer Motion / GSAP. CSS transitions + small IIFE-wrapped JS is the budget.

## The 100/300/500 rule

Timing matters more than easing. These durations feel right for most UI:

| Duration | Use | Examples |
|---|---|---|
| **100–150ms** | Instant feedback | Button press, toggle, color change |
| **200–300ms** | State change | Menu open, tooltip, hover, focus ring |
| **300–500ms** | Layout change | Accordion, drawer, modal, accordion |
| **500–800ms** | Entrance animation | Page load, hero reveal, on-scroll fade-up |

**Exit animations are faster than entrances** — typically 75% of enter duration. (User wants the modal to dismiss snappily; the entrance is when delight matters.)

## Easing: pick the right curve

**Don't use `ease`.** It's the browser default and rarely optimal.

```css
:root {
  --ds-ease-out:       cubic-bezier(0.16, 1, 0.3, 1);   /* expo out — confident */
  --ds-ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);   /* quart out — refined */
  --ds-ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);  /* quint out — slightly more dramatic */
  --ds-ease-in:        cubic-bezier(0.7, 0, 0.84, 0);   /* for exits */
  --ds-ease-in-out:    cubic-bezier(0.65, 0, 0.35, 1);  /* state toggles (there → back) */
}
```

**Ease-out exponential is the default for entrances**. It mimics real-world deceleration (friction, drag).

**No bounce, no elastic.** Trendy in 2015, now feels tacky. Real objects don't bounce when they stop — they decelerate smoothly. Overshoot effects draw attention to the animation itself rather than the content.

## What you can animate (without performance penalty)

```
✅ transform     (translate, scale, rotate)
✅ opacity
✅ filter        (blur, brightness, saturation — bounded use)
✅ backdrop-filter (frosted-glass effects — bounded use)
✅ clip-path     (wipes, reveals)
```

```
❌ width / height — triggers layout
❌ top / left / right / bottom — triggers layout
❌ margin / padding — triggers layout
❌ font-size — triggers layout
```

Animating layout-driving properties forces recalc + repaint per frame. On a slow phone, 60fps drops to 30fps fast. The hard rule: **animate `transform` and `opacity` for movement; for size changes, use `transform: scale()` (visual scaling without layout) or FLIP-pattern (measure → set transform → animate to identity).**

## Animation patterns

### Stagger orchestration (entry)

```css
.list-item {
  opacity: 0;
  transform: translateY(8px);
  animation: fade-up 600ms var(--ds-ease-out) both;
  animation-delay: calc(var(--i, 0) * 50ms);
}

@keyframes fade-up {
  to { opacity: 1; transform: translateY(0); }
}
```

```html
<li style="--i: 0">…</li>
<li style="--i: 1">…</li>
<li style="--i: 2">…</li>
```

**Cap total stagger time**: 10 items × 50ms = 500ms total. Scale per-item delay down for longer lists (10 items @ 50ms is fine; 30 items @ 50ms = 1500ms is annoying).

### Perpetual micro-interactions (motion ≥ 7)

When the dial is high, at least one perpetual element should be on the page:

```css
/* Pulse — for status dots */
@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}
.status-dot { animation: pulse 2s var(--ds-ease-in-out) infinite; }

/* Shimmer — for skeleton loading */
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg,
    oklch(92% 0 0) 0%,
    oklch(96% 0 0) 50%,
    oklch(92% 0 0) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}

/* Marquee — for kinetic text bands */
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.marquee { animation: marquee 20s linear infinite; }
```

### Typewriter (cycling input prompts)

```javascript
(function() {
  const phrases = ["搜索商品", "拼团秒杀", "限时特价"];
  let i = 0;
  const el = document.querySelector('.search-placeholder');
  if (!el) return;

  function cycle() {
    el.textContent = phrases[i];
    i = (i + 1) % phrases.length;
    setTimeout(cycle, 3000);
  }
  cycle();
})();
```

Wrap perpetual JS in IIFE to avoid global pollution. Don't use `setInterval` if `setTimeout` recursion suffices — it's easier to pause / cancel.

## Hover-aware (desktop only)

```css
@media (hover: hover) {
  .button:hover { transform: translateY(-1px); }
}
```

Mobile devices don't support `:hover` semantically (it sticks after tap). Gate hover-only effects behind `(hover: hover)`.

## Tactile feedback on click

```css
.button:active { transform: scale(0.98); }
```

Subtle scale-down on `:active` simulates a physical push. ~50ms duration is implicit (CSS default). Don't add explicit `transition` for `:active` — it loses the snap.

## Reduced motion (mandatory)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
```

This is non-negotiable. Vestibular disorders affect ~35% of adults over 40. Functional animations (loading spinners, focus indicators) should still work, just without spatial movement.

A more elegant approach: define alternate animations that use opacity-only (crossfade) for reduced-motion preference, instead of disabling animation entirely.

```css
.card { animation: slide-up 500ms var(--ds-ease-out); }

@media (prefers-reduced-motion: reduce) {
  .card { animation: fade-in 200ms ease-out; }
}
```

## Scroll-triggered animation (use IntersectionObserver)

**Never `addEventListener('scroll')`** for animations. Browser fires scroll events at 60–120 Hz; doing layout work in the handler is a frame-budget killer.

```javascript
(function() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal');
        observer.unobserve(entry.target);  // fire once
      }
    });
  }, { threshold: 0.2 });

  document.querySelectorAll('.reveal-on-scroll').forEach(el => observer.observe(el));
})();
```

`unobserve` after firing — otherwise the observer keeps watching forever.

## Perceived performance

The 80ms threshold: human brain buffers sensory input for ~80ms to synchronize perception. Anything under 80ms feels instant. This is the target for micro-interactions (button press, toggle, hover).

Active vs passive time: passive waiting (staring at a spinner) feels longer than active engagement. Strategies:

- **Preemptive start**: begin transition immediately while loading (skeleton UI, page-zoom animation).
- **Optimistic UI**: update the interface immediately; handle failures gracefully later. Use for low-stakes actions.
- **Progressive content**: stream / paginate; don't wait for everything.

## Cross-references

- Dial-driven rules: `01_design_dials.md` (motion intensity tiers)
- Reduced motion is a a11y commitment: `06_interaction_states.md`
- Anti-pattern: heavy bouncy animation, custom cursors — see `09_absolute_bans.md`
