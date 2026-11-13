/** Scoped graph workspace styling; never changes the host conversation shell. */
export const graphStyles = `
.design-graph-view{--graph-ink:var(--ds-text-primary,var(--dsw-alias-label-primary,light-dark(#273442,#f2f2f5)));--graph-muted:var(--ds-text-tertiary,var(--dsw-alias-label-tertiary,light-dark(#748091,#aaaab5)));--graph-border:var(--ds-line-2,var(--dsw-alias-border-l2,light-dark(#e5e9ef,#46464e)));--graph-accent:var(--ds-brand-text-primary,light-dark(#7561b2,#bba5ff));--graph-surface:var(--ds-bg-white,var(--dsw-alias-bg-base,light-dark(#fff,#19191c)));--graph-subtle:var(--ds-fill-2,var(--dsw-alias-bg-layer-1,light-dark(#f8fafc,#232326)));--graph-selected:var(--ds-brand-1,light-dark(#f2eefb,#2c2342));position:relative;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--graph-ink);background:var(--graph-subtle);font:13px/1.5 system-ui,sans-serif;container-type:inline-size}
.design-graph-view *{box-sizing:border-box}
.design-graph-view button:not(:where(.dsh-design-view-switcher>button,.graph-inspector button,.graph-settings-trigger,.graph-camera-action)),.design-graph-view select,.design-graph-view input{font:inherit;color:inherit;max-width:100%;border:1px solid var(--graph-border);border-radius:7px;background:var(--graph-surface);padding:6px 10px;min-height:32px}
.design-graph-view button,.design-graph-view summary{cursor:pointer}
.design-graph-view button:not(:where(.dsh-design-view-switcher>button,.graph-inspector button,.graph-settings-trigger,.graph-camera-action)):hover,.design-graph-view summary:hover{background:var(--graph-subtle)}
.design-graph-view button:disabled{opacity:.45;cursor:default}
.design-graph-view :focus-visible{outline:2px solid #8b75cc;outline-offset:2px}
.graph-toolbar{position:relative;z-index:4;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:var(--graph-surface);border-bottom:1px solid var(--graph-border);flex-shrink:0}
.graph-levels{display:flex;padding:3px;gap:2px;background:var(--graph-subtle);border-radius:8px}
.graph-levels button{border:0;background:transparent;padding:4px 12px;min-height:28px;font-size:12px}
.graph-levels button[aria-pressed=true]{background:var(--graph-surface);color:var(--graph-accent);box-shadow:0 1px 4px #28334b16}
.graph-search{flex:1 1 170px;min-width:110px;position:relative}
.graph-search input{width:100%;padding-left:31px;background:var(--graph-subtle)}
.graph-search:before{content:'';position:absolute;top:10px;left:11px;width:9px;height:9px;border:1.5px solid #8893a3;border-radius:50%;pointer-events:none}
.graph-search:after{content:'';position:absolute;top:20px;left:21px;width:5px;border-top:1.5px solid #8893a3;transform:rotate(45deg);pointer-events:none}
.graph-toolbar select{font-size:12px;max-width:145px}
.graph-refresh{white-space:nowrap;font-size:12px!important;color:var(--graph-accent)!important}
.graph-settings-trigger{position:relative;flex-shrink:0;margin-left:auto}
.graph-settings-trigger[aria-expanded=true]{background:var(--graph-selected);border-color:var(--graph-border);color:var(--graph-accent)}
.graph-settings-count{position:absolute;top:-4px;right:-4px;display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#7561b2;color:#fff;font-size:10px}
.graph-settings-drawer{position:absolute;z-index:9;top:58px;right:12px;bottom:58px;width:326px;max-width:calc(100% - 24px);display:flex;flex-direction:column;background:var(--graph-surface);border:1px solid var(--graph-border);border-radius:14px;box-shadow:0 16px 46px #25344b24;backdrop-filter:blur(14px);overflow:hidden}
.graph-settings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:17px 18px 13px;border-bottom:1px solid var(--graph-border)}
.graph-settings-head strong{display:block;font-size:14px}.graph-settings-head p{margin:3px 0 0;color:var(--graph-muted);font-size:11px}
.graph-settings-head button{border:0;background:transparent;padding:0 7px;min-height:28px;font-size:19px;color:var(--graph-muted)}
.graph-settings-scroll{padding:16px 18px 18px;overflow:auto}
.graph-settings-section{min-inline-size:0;border:0;margin:16px 0 0;padding:0 0 16px;border-bottom:1px solid var(--graph-border)}
.graph-settings-section:first-child{margin-top:0}
.graph-settings-section:last-of-type{border-bottom:0}
.graph-settings-section legend{padding:0;margin:0 0 8px;color:var(--graph-ink);font-size:12px;font-weight:500}
.graph-settings-section label{display:grid;grid-template-columns:82px minmax(0,1fr);align-items:center;gap:10px;margin:0;color:var(--graph-ink);font-size:12px}
.graph-settings-section label+label{margin-top:8px}
.graph-settings-section select{width:100%;max-width:none;background:var(--graph-subtle)}
.graph-settings-note{margin:8px 0 0;color:var(--graph-muted);font-size:11px;line-height:1.6}
.graph-settings-actions{display:flex;gap:8px;padding-top:13px}.graph-settings-actions button{flex:1;font-size:12px}
.graph-popover{position:relative}
.graph-popover>summary{list-style:none;border:1px solid var(--graph-border);border-radius:7px;padding:6px 10px;min-height:32px;white-space:nowrap;background:var(--graph-surface);font-size:12px}
.graph-popover>summary::-webkit-details-marker{display:none}
.graph-popover[open]>summary{background:var(--graph-selected);color:var(--graph-accent);border-color:var(--graph-border)}
.graph-popover-body{position:absolute;top:calc(100% + 8px);right:0;width:270px;max-width:calc(100cqw - 24px);padding:16px;border:1px solid var(--graph-border);border-radius:10px;background:var(--graph-surface);box-shadow:0 8px 28px #23344a1c;z-index:8;max-height:55vh;overflow:auto;font-size:12px}
.graph-popover-body label{display:grid;gap:6px;margin-bottom:12px;color:var(--graph-muted)}
.graph-popover-body select{max-width:none;width:100%}
.graph-popover-body p{margin:8px 0;overflow-wrap:anywhere}
.graph-view-body{position:relative;flex:1;min-height:0;display:flex;overflow:hidden}
.graph-view-note{padding:7px 16px;font-size:11px;color:var(--graph-muted);background:var(--graph-subtle);flex-shrink:0}
.graph-canvas{height:100%;width:100%}
.graph-camera-tools{position:absolute;right:16px;bottom:16px;display:flex;gap:5px;flex-wrap:wrap;padding:4px;background:var(--graph-surface);border:1px solid var(--graph-border);border-radius:9px;box-shadow:0 2px 10px #21354a0c;max-width:calc(100% - 32px)}
.graph-camera-tools button:not(.graph-camera-action){border:0;background:transparent;font-size:12px;padding:4px 8px;min-height:28px}
.graph-camera-tools button[aria-pressed=true]{background:var(--graph-selected)}
.graph-camera-tools .graph-popover>summary{border:0;background:transparent;padding:4px 8px;min-height:28px}
.graph-camera-tools .graph-popover-body{top:auto;bottom:calc(100% + 8px)}
.graph-inspector{position:absolute;z-index:7;top:12px;right:12px;bottom:64px;width:400px;max-width:calc(100% - 24px);background:var(--graph-surface);border:1px solid var(--graph-border);border-radius:12px;box-shadow:0 4px 22px #27374e13;overflow:auto;overflow-wrap:anywhere;overscroll-behavior:contain}
.graph-inspector>.dsh-design-record-header{position:sticky;top:0;z-index:1}
.graph-inspector-body{padding:var(--ygd-panel-detail-section-gap,16px)}
.graph-inspector-actions{display:flex;flex-wrap:wrap;gap:var(--ygd-panel-detail-control-gap,8px)}
.graph-search-results{position:absolute;z-index:6;top:100%;left:16px;right:16px;max-height:230px;overflow:auto;background:var(--graph-surface);border:1px solid var(--graph-border);box-shadow:0 6px 20px #21354a14;border-radius:0 0 10px 10px;padding:12px}
.graph-search-results summary{font-size:12px;color:var(--graph-muted);margin-bottom:8px}
.graph-search-results>div{display:flex;flex-wrap:wrap;gap:6px}
.graph-statusbar{position:relative;z-index:5;display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px;padding:8px 16px;background:var(--graph-surface);border-top:1px solid var(--graph-border);font-size:11px;color:var(--graph-muted);flex-shrink:0}
.graph-initial-stage{flex:1;min-height:0;display:grid;place-items:center;overflow:auto;padding:24px}
.graph-initial-status{position:relative;width:min(100%,460px);padding:24px 28px;border:1px solid var(--graph-border);border-radius:12px;background:var(--graph-surface);color:var(--graph-muted);box-shadow:0 8px 28px #2538500a}
.graph-initial-status strong{display:block;color:var(--graph-ink);font-size:14px;font-weight:600}
.graph-initial-status p{margin:10px 0 0;line-height:1.6;font-size:12px}
.graph-initial-status small{display:block;margin-top:10px;line-height:1.5;font-size:11px;color:var(--graph-muted)}
.graph-progress{position:absolute;left:0;right:0;top:-2px;height:2px;overflow:hidden;background:#e5f0ed}
.graph-progress::before{content:'';position:absolute;top:0;bottom:0;left:0;width:34%;background:#3f9e8b;animation:graph-progress-pulse 1.6s ease-in-out infinite}
@keyframes graph-progress-pulse{0%{transform:translateX(-110%);opacity:.45}50%{opacity:1}100%{transform:translateX(310%);opacity:.45}}
@media(prefers-reduced-motion:reduce){.graph-progress::before{animation:none;width:100%;opacity:.8}}
.graph-statusbar .graph-popover{margin-left:auto}
.graph-statusbar .graph-popover>summary{border:0;padding:0;min-height:0;font-size:11px;color:var(--graph-muted)}
.graph-statusbar .graph-popover-body{top:auto;bottom:calc(100% + 12px);width:360px;color:var(--graph-muted)}
.graph-health{display:flex;align-items:center;gap:6px;color:var(--graph-muted)}
.graph-health-dot{width:6px;height:6px;border-radius:50%;background:#8baaa0;flex-shrink:0}
.graph-health[data-warning=true] .graph-health-dot{background:#c69c57}
.graph-scopebar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 16px;background:var(--graph-selected);border-bottom:1px solid var(--graph-border);font-size:12px;color:var(--graph-accent);flex-shrink:0}
.graph-scopebar button{border:0;background:transparent;min-height:24px;padding:2px 6px;font-size:11px}
.graph-notice{padding:8px 16px;margin:0;background:var(--ds-warning-1,light-dark(#fff7e8,#3d2b18));color:var(--ds-warning-text-primary,light-dark(#8c692d,#ffc58a));font-size:12px}
.graph-legend{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0}.graph-legend i{display:inline-block;width:18px;border-top:2px solid #617291;vertical-align:middle;margin-right:5px}.graph-legend i[data-kind=contains]{border-top:1px solid #76859b;opacity:.65}
@container(max-width:700px){.graph-toolbar{gap:8px;padding:10px 12px}.graph-search{order:2;flex-basis:100%}.graph-settings-trigger{margin-left:0}.graph-settings-drawer{top:96px;right:8px;bottom:54px;width:310px}.graph-toolbar>.graph-popover{margin-left:auto}.graph-toolbar select{max-width:118px}.graph-statusbar{padding:7px 12px;gap:5px 10px}.graph-toolbar>.graph-popover,.graph-statusbar>.graph-popover{position:static}.graph-popover-body{right:12px}.graph-inspector{width:360px;top:8px;right:8px;bottom:68px}.graph-camera-tools{right:8px!important;bottom:8px!important}}
@container(max-width:460px){.graph-inspector{top:auto;left:8px;right:8px;bottom:56px;width:auto;max-width:none;max-height:65%}.graph-toolbar>select{margin-left:auto}.graph-toolbar>.graph-popover{margin-left:0}.graph-statusbar .graph-popover{margin-left:0}}
`
