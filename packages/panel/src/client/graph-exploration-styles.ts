/** Specialist canvas only. Ordinary controls and the evidence inspector stay shared. */
export const explorationStyles = `
.graph-exploration{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;position:relative}
.graph-exploration-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 16px;background:var(--ds-bg-white,#fff);border-bottom:1px solid var(--ds-line-2,#e5e9ef)}
.graph-exploration-toolbar [role=group]{display:flex;gap:6px;align-items:center}.graph-exploration-toolbar small{color:var(--ds-text-secondary,#667085);font-size:12px}.graph-exploration-toolbar button[aria-pressed=true]{border-color:var(--ds-brand-bg-default,#7561b2);color:var(--ds-brand-bg-default,#7561b2)}
.graph-exploration-stage{position:relative;flex:1;min-height:350px;overflow:hidden;background:#050c1c;--graph-label:#dce8ff;--graph-faint:#9aadc9}
.graph-exploration-stage[data-style=depth]{background:#0b102c;--graph-label:#f1eaff;--graph-faint:#b8b3d5}
.graph-exploration-stage svg{display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none;font-family:var(--font-main,system-ui,sans-serif)}
.graph-exploration-stage .exploration-link{transition:stroke-opacity .16s;fill:none;vector-effect:non-scaling-stroke}
.graph-exploration-stage .exploration-node{cursor:pointer;outline:none}.graph-exploration-stage .exploration-node:focus-visible .exploration-focus{stroke:#fff;stroke-width:3;opacity:1}
.graph-exploration-stage text{pointer-events:none;fill:var(--graph-label);paint-order:stroke;stroke:#050c1c;stroke-width:4px;stroke-linejoin:round}
.graph-exploration-stage .exploration-sector{cursor:pointer;outline:none}.graph-exploration-stage .exploration-sector:focus-visible path{stroke:#fff;stroke-width:7}
.graph-exploration-stage .exploration-pulse{transform-box:fill-box;transform-origin:center;animation:exploration-pulse 2.8s ease-in-out infinite}
.graph-exploration-stage[data-motion=off] .exploration-pulse{animation:none}
.graph-exploration-legend{position:absolute;left:18px;bottom:16px;pointer-events:none;color:#b8c9e5;font-size:12px;line-height:1.8;padding:9px 12px;border:1px solid #7799cc30;border-radius:8px;background:#071125d9;max-width:calc(100% - 36px)}
.graph-exploration-count{position:absolute;left:18px;top:14px;color:#adbfdb;font-size:12px;pointer-events:none;letter-spacing:.02em}
@keyframes exploration-pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.graph-exploration-stage .exploration-pulse{animation:none}.graph-exploration-stage .exploration-link{transition:none}}
@container(min-width:1000px){.graph-view-body[data-exploring=true][data-inspecting=true] .graph-exploration-stage{margin-right:344px}}
@container(max-width:700px){.graph-exploration-toolbar{padding:8px 12px;gap:8px}.graph-exploration-legend{left:8px;bottom:8px;font-size:12px}.graph-exploration-stage{min-height:360px}}
`
