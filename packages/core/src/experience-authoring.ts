/** System-owned authoring guidance. Delivered on prepare, not installed in a Kit. */
export const EXPERIENCE_AUTHORING_VERSION = 'web-explanation-v1'

export const EXPERIENCE_AUTHORING_GUIDE = `
Purpose and ownership
Help the user understand how the existing design addresses a concrete situation, then judge and discuss it. This is a system-level cross-Bundle derived explanation, not a new Bundle, product implementation or confirmed design fact. Use the user's language. The default is a guided web explanation; do not build a canvas editor, slideshow or complete application unless requested.

Domain-independent method
Design may describe a service, a learning plan, an event, an organization or a physical setting, not just software. Do not assume screens, clicks, an application user or a product funnel. Start with what the audience needs to understand or judge, then select evidence and a representation. Existing Kit and Bundle content supplies domain knowledge; this method supplies no domain rules.
Possible explanation purposes include understanding an experience, a rule's consequences, tradeoffs between proposals, collaboration between roles, or relationships between concepts. These are examples, not an exhaustive taxonomy or mandatory output fields. Combine representations only when they serve one clear question.
Choose structure from the subject: sequence for dependent changes, branches for conditional outcomes, aligned comparison for alternatives, spatial arrangement for a setting, or a relationship diagram for dependencies. Use a sequence only when order is meaningful. Do not convert every explanation into an operational journey. Across any structure, keep the same entities, conditions, units and comparison criteria consistent; make causal links and unknowns explicit. Never invent quantitative estimates to make a diagram or comparison look complete.

Before writing
1. Choose one situation: who is trying to do what, in which circumstances, and what should become understandable by the end? State the situation and how the design helps in a short introduction, not an abstract capability inventory. Do not add an interview gate when a clearly marked, reversible example is sufficient.
2. Read current owner Design Files and relevant artifacts yourself. Map each demonstrated behavior to saved evidence. Reuse relevant existing page structure, style, assets and terminology when available, without importing unrelated navigation or implying unsaved behavior. Capture every source actually used, including source HTML and supported visual resources; if new evidence is discovered, prepare again with the complete source list before publishing. Preserve prior user-approved scene choices on a local revision.
3. Distinguish accepted design, invented demonstration data, and unresolved product decisions. Do not infer product rules from realistic sample data. When evidence does not establish what happens, show the uncertainty or bounded alternatives rather than silently resolving it. Do not use another _experiences view as product authority.
4. Select the representation for the explanation: a concrete interface fragment for an operation, a before/after comparison for a change, a diagram for relationships or handoffs. Not every subject needs a prototype. Avoid replacing a concrete user experience with an abstract diagram merely to simplify layout.

Continuity and page composition
Begin with a light context block: the assumed situation and a concise account of how the design helps. The Panel already supplies the scene title and navigation; do not repeat the title or add another application header.
Use a readable vertical narrative as the default. For each meaningful unit, give a consistent step heading when sequence matters, a short lead-in, one visibly bounded demonstration region, and only the caption needed to interpret its result. Separate successive units clearly. A single comparison or diagram need not have numbered steps; these are composition conventions, not mandatory filled-out form fields.
Split by meaningful changes in the user's task, action or result, not by Bundle, file, screen count or an arbitrary three-step quota. Actions within the same interface should normally share that interface and evolving state. When a new view is needed, retain the same selected object, names and inputs; make the carried-forward result visible. Never present three disconnected screens as one journey.
Explain adjacent to the corresponding object or change, instead of giving a lecture above an unrelated miniature screenshot. Keep a clear reading start and one dominant focus. Use readable type and contrast, restrained heading levels and whitespace; do not shrink text to fit a dashboard of equal-weight panels. Keep enough real context to recognize the situation, without inventing menus, metrics or features to fill empty space.

Bounded interaction
The central explanation and a representative outcome or relationship must be understandable without clicking or entering data. Pre-populate clearly identified sample state when useful. Add interaction only to illuminate a decision, relationship or change: choosing an example, exposing a reason, changing a bounded input, or comparing an outcome. Couple dependent units so inputs and consequences refer to the same entities; do not reset unrelated local state during normal interactions. A static explanation is valid when interaction adds no understanding.
Distinguish explanation controls from actions in the proposed design. A navigation control must not ambiguously mean both 'next explanation unit' and an actual service or product action. Say precisely what the audience is examining and can judge; avoid a vague 'try the experience'. Mark the view as an illustration and identify invented data without repeating warnings in every block.
Interactions stay local and temporary: no network requests, host actions or product writes. Do not add a second chat, real-looking submission or persistent-save claim. A request to change the product goes through the existing main conversation and original owner Bundle workflow, never just a demo edit.

Review before publication
Inspect the whole rendered page, the first viewport and each important local interaction at the actual Panel width; also check a narrower viewport. Check readability, clipping, excessive introductory text, repeated titles, confusing control labels, object continuity and resulting state. An overview alone is not enough: zoomed-out text can conceal unusable detail. Browser inspection should be bounded to this view; do not test unrelated product flows or repair host code. If visual tools are unavailable, explicitly report that visual quality is unverified rather than claiming it looks correct.
Check semantic fidelity separately from HTML completeness. Can the audience identify the situation or question, explain the proposed help or relationship, distinguish evidence from examples and unknowns, and identify what they can judge or change? Assess continuity for a sequence, comparable conditions for alternatives, and clear relationships for a diagram; do not grade every form by clicks or step count. The publish operation checks file/source constraints, not aesthetics or user understanding. Repair concrete issues found in the view, then publish through the existing lifecycle. In the handoff, state what the example illustrates, material assumptions, what was actually checked and remaining limitations. Do not call a static mockup a working product.

Starter use
The accompanying htmlStarter is an optional structural starting point, not an artifact to publish unchanged. Replace its bracketed placeholders with grounded, concrete content. Add or remove units to fit the subject, reuse saved styling when appropriate, and keep non-UI subjects non-UI. Do not generate screenshots as an intermediate step when direct HTML or inline SVG can convey the same content.
`.trim()

export const EXPERIENCE_HTML_STARTER = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>[Scene title for browser metadata only]</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#293640;font:16px/1.8 system-ui,sans-serif}
main{max-width:960px;margin:auto;padding:24px}p{margin:0}.context{border-left:3px solid #d5dde3;padding-left:16px}
.context p+p{margin-top:8px}.disclosure{font-size:13px;color:#536471;margin-top:12px}
.unit{margin-top:24px}.unit+.unit{border-top:2px solid #dce2e7;padding-top:24px}
h2{font-size:18px;line-height:1.6;margin:0 0 8px}.lead{margin-bottom:14px}
figure{margin:0}.demonstration{border:1px solid #cbd5dd;border-radius:6px;padding:20px;min-width:0}
figcaption{margin-top:10px;color:#4e606d;font-size:15px}button,input,textarea,select{font:inherit}
:focus-visible{outline:2px solid #467394;outline-offset:3px}@media(max-width:560px){main{padding:18px}.demonstration{padding:14px}}
</style></head>
<body><main>
<div class="context"><p>[Concrete situation or question and who it matters to.]</p><p>[What the existing design proposes and what this explanation helps the audience understand or judge.]</p></div>
<p class="disclosure">[Clearly identify demonstration data, temporary interaction and any unresolved behavior.]</p>
<section class="unit" aria-labelledby="unit-1">
<h2 id="unit-1">[Meaningful question, relationship or action; number only when order matters]</h2>
<p class="lead">[Introduce what is shown and what to notice.]</p>
<figure><div class="demonstration">
<!-- Replace with an evidence-backed representation appropriate to the subject.
     It may be a relationship, setting, comparison, conditional outcome or interface fragment.
     Do not invent an application UI for a non-software subject.
     Show a representative state/result by default; do not leave an empty placeholder.
     When adding interaction, keep shared object identity and local state consistent. -->
</div><figcaption>[Only the explanation needed to connect this display to its consequence; omit if redundant.]</figcaption></figure>
</section>
<!-- Continue the same situation only where another meaningful unit is needed.
     Do not copy a fixed number of steps or repeat the same application chrome. -->
</main></body></html>`
