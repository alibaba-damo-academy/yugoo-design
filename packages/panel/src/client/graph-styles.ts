/** Scoped graph workspace styling; never changes the host conversation shell. */
export const graphStyles = `
.design-graph-view{--graph-ink:#273442;--graph-muted:#748091;--graph-border:#e5e9ef;--graph-accent:#7561b2;position:relative;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--graph-ink);background:#f8fafc;font:13px/1.5 system-ui,sans-serif;container-type:inline-size}
.design-graph-view *{box-sizing:border-box}
.design-graph-view button,.design-graph-view select,.design-graph-view input{font:inherit;color:inherit;max-width:100%;border:1px solid var(--graph-border);border-radius:7px;background:#fff;padding:6px 10px;min-height:32px}
.design-graph-view button,.design-graph-view summary{cursor:pointer}
.design-graph-view button:hover,.design-graph-view summary:hover{background:#f1f3f8}
.design-graph-view button:disabled{opacity:.45;cursor:default}
.design-graph-view :focus-visible{outline:2px solid #8b75cc;outline-offset:2px}
.graph-toolbar{position:relative;z-index:4;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:#fff;border-bottom:1px solid var(--graph-border);flex-shrink:0}
.graph-title{font-size:15px;letter-spacing:-.3px;margin-right:5px;white-space:nowrap}
.graph-levels{display:flex;padding:3px;gap:2px;background:#f1f3f7;border-radius:8px}
.graph-levels button{border:0;background:transparent;padding:4px 12px;min-height:28px;font-size:12px}
.graph-levels button[aria-pressed=true]{background:#fff;color:#655198;box-shadow:0 1px 4px #28334b16}
.graph-search{flex:1 1 170px;min-width:110px;position:relative}
.graph-search input{width:100%;padding-left:31px;background:#f8fafc}
.graph-search:before{content:'';position:absolute;top:10px;left:11px;width:9px;height:9px;border:1.5px solid #8893a3;border-radius:50%;pointer-events:none}
.graph-search:after{content:'';position:absolute;top:20px;left:21px;width:5px;border-top:1.5px solid #8893a3;transform:rotate(45deg);pointer-events:none}
.graph-toolbar select{font-size:12px;max-width:145px}
.graph-refresh{white-space:nowrap;font-size:12px!important;color:#655198!important}
.graph-settings-trigger{display:flex;align-items:center;gap:7px;white-space:nowrap;margin-left:auto}
.graph-settings-trigger[aria-expanded=true]{background:#f2eefb;border-color:#dcd3f0;color:#655198}
.graph-settings-count{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#7561b2;color:#fff;font-size:10px}
.graph-settings-drawer{position:absolute;z-index:9;top:58px;right:12px;bottom:58px;width:326px;max-width:calc(100% - 24px);display:flex;flex-direction:column;background:#fffffff5;border:1px solid #e1e5ec;border-radius:14px;box-shadow:0 16px 46px #25344b24;backdrop-filter:blur(14px);overflow:hidden}
.graph-settings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:17px 18px 13px;border-bottom:1px solid #e7eaf0}
.graph-settings-head strong{display:block;font-size:14px}.graph-settings-head p{margin:3px 0 0;color:#7a8493;font-size:11px}
.graph-settings-head button{border:0;background:transparent;padding:0 7px;min-height:28px;font-size:19px;color:#7d8694}
.graph-settings-scroll{padding:4px 18px 18px;overflow:auto}
.graph-settings-section{border:0;margin:0;padding:15px 0;border-bottom:1px solid #eceff3}
.graph-settings-section:last-of-type{border-bottom:0}
.graph-settings-section legend{padding:0;margin-bottom:10px;color:#56657a;font-size:11px;font-weight:650;letter-spacing:.03em}
.graph-settings-section label{display:grid;grid-template-columns:82px minmax(0,1fr);align-items:center;gap:10px;margin:8px 0;color:#707d8f;font-size:12px}
.graph-settings-section select{width:100%;max-width:none;background:#f9fafc}
.graph-settings-note{margin:2px 0 10px;color:#828c9a;font-size:11px;line-height:1.6}
.graph-settings-actions{display:flex;gap:8px;padding-top:13px}.graph-settings-actions button{flex:1;font-size:12px}
.graph-popover{position:relative}
.graph-popover>summary{list-style:none;border:1px solid var(--graph-border);border-radius:7px;padding:6px 10px;min-height:32px;white-space:nowrap;background:#fff;font-size:12px}
.graph-popover>summary::-webkit-details-marker{display:none}
.graph-popover[open]>summary{background:#f2eefb;color:#655198;border-color:#ded5f2}
.graph-popover-body{position:absolute;top:calc(100% + 8px);right:0;width:270px;max-width:calc(100cqw - 24px);padding:16px;border:1px solid var(--graph-border);border-radius:10px;background:#fff;box-shadow:0 8px 28px #23344a1c;z-index:8;max-height:55vh;overflow:auto;font-size:12px}
.graph-popover-body label{display:grid;gap:6px;margin-bottom:12px;color:#637185}
.graph-popover-body select{max-width:none;width:100%}
.graph-popover-body p{margin:8px 0;overflow-wrap:anywhere}
.graph-view-body{position:relative;flex:1;min-height:0;display:flex;overflow:hidden}
.graph-view-note{padding:7px 16px;font-size:11px;color:#727b8b;background:#f8f9fc;flex-shrink:0}
.graph-canvas{height:100%;width:100%}
.graph-camera-tools{padding:4px;background:#ffffffee;border:1px solid var(--graph-border);border-radius:9px;box-shadow:0 2px 10px #21354a0c;max-width:calc(100% - 32px)}
.graph-camera-tools button{border:0;background:transparent;font-size:12px;padding:4px 8px;min-height:28px}
.graph-camera-tools button[aria-pressed=true]{background:#eee8fa}
.graph-inspector{position:absolute;z-index:3;top:12px;right:12px;bottom:64px;width:320px;max-width:calc(100% - 24px);padding:18px;background:#fffffff5;border:1px solid var(--graph-border);border-radius:12px;box-shadow:0 4px 22px #27374e13;overflow:auto;overflow-wrap:anywhere;backdrop-filter:blur(10px)}
.graph-inspector h4{font-size:16px;line-height:1.45;margin:10px 0;color:#243246}
.graph-inspector h5{font-size:12px;margin:18px 0 8px;color:#6e7a8d;font-weight:500}
.graph-inspector p{margin:8px 0}
.graph-inspector small{font-size:11px;color:var(--graph-muted)}
.graph-inspector-head{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#827096;font-size:11px}
.graph-inspector-head button{padding:0 8px;border:0;background:transparent;min-height:26px;font-size:18px;color:#7a8596}
.graph-inspector-actions{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0}
.graph-inspector-actions button{font-size:12px}
.graph-source-path{padding:8px 10px;border-radius:6px;background:#f3f5f9;font:11px/1.5 ui-monospace,monospace;color:#718095}
.graph-node-source{margin:14px 0;padding:14px;background:#f6f8fc;border:1px solid #e4e9f1;border-radius:10px;overflow-wrap:anywhere}
.graph-source-heading{font-size:10px;color:#7a8494;letter-spacing:.12em;margin-bottom:10px}
.graph-source-panel{display:flex;align-items:center;gap:10px;margin-bottom:12px}.graph-source-panel strong{font-size:13px;color:#485a77}.graph-source-panel small{font-size:10px;color:#7a8494}
.graph-node-source dl{margin:0}.graph-node-source dt{font-size:10px;color:#7a8494;margin-top:10px}.graph-node-source dd{font-family:ui-monospace,monospace;font-size:11px;line-height:1.6;margin:3px 0 0;color:#42536e}.graph-node-source>small{display:block;font-size:10px;color:#8c94a1;margin-top:12px}
.graph-source-caption{color:#778293;font-size:12px}
.graph-relation-detail{border-top:1px solid var(--graph-border);padding-top:10px;margin-top:12px}
.graph-relation-statement{font-weight:500;line-height:1.8}.graph-relation-statement span{font-weight:400;color:#75618e}
.graph-relation-meta{display:grid;grid-template-columns:34px minmax(0,1fr);gap:4px 8px;font-size:12px;margin:10px 0}.graph-relation-meta dt{color:var(--graph-muted)}.graph-relation-meta dd{margin:0;overflow-wrap:anywhere}
.graph-unit-list{display:flex;flex-direction:column;gap:5px;margin-bottom:16px}
.graph-unit-list button{text-align:left;font-size:12px;background:#f8fafc;border-color:transparent}
.graph-unit-list button:hover{border-color:#ded5f2;background:#f5f1fb}
.graph-evidence{margin-top:14px;padding-top:12px;border-top:1px solid var(--graph-border)}
.graph-evidence summary{font-size:12px;color:#657487}
.graph-evidence pre{white-space:pre-wrap;font:11px/1.7 ui-monospace,monospace;color:#586678}
.graph-search-results{position:absolute;z-index:6;top:100%;left:16px;right:16px;max-height:230px;overflow:auto;background:#fff;border:1px solid var(--graph-border);box-shadow:0 6px 20px #21354a14;border-radius:0 0 10px 10px;padding:12px}
.graph-search-results summary{font-size:12px;color:#7a8596;margin-bottom:8px}
.graph-search-results>div{display:flex;flex-wrap:wrap;gap:6px}
.graph-statusbar{position:relative;z-index:5;display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px;padding:8px 16px;background:#fff;border-top:1px solid var(--graph-border);font-size:11px;color:var(--graph-muted);flex-shrink:0}
.graph-initial-stage{flex:1;min-height:0;display:grid;place-items:center;overflow:auto;padding:24px}
.graph-initial-status{position:relative;width:min(100%,460px);padding:24px 28px;border:1px solid var(--graph-border);border-radius:12px;background:#fff;color:var(--graph-muted);box-shadow:0 8px 28px #2538500a}
.graph-initial-status strong{display:block;color:var(--graph-ink);font-size:14px;font-weight:600}
.graph-initial-status p{margin:10px 0 0;line-height:1.6;font-size:12px}
.graph-initial-status small{display:block;margin-top:10px;line-height:1.5;font-size:11px;color:var(--graph-muted)}
.graph-progress{position:absolute;left:0;right:0;top:-2px;height:2px;overflow:hidden;background:#e5f0ed}
.graph-progress::before{content:'';position:absolute;top:0;bottom:0;left:0;width:34%;background:#3f9e8b;animation:graph-progress-pulse 1.6s ease-in-out infinite}
@keyframes graph-progress-pulse{0%{transform:translateX(-110%);opacity:.45}50%{opacity:1}100%{transform:translateX(310%);opacity:.45}}
@media(prefers-reduced-motion:reduce){.graph-progress::before{animation:none;width:100%;opacity:.8}}
.graph-statusbar .graph-popover{margin-left:auto}
.graph-statusbar .graph-popover>summary{border:0;padding:0;min-height:0;font-size:11px;color:var(--graph-muted)}
.graph-statusbar .graph-popover-body{top:auto;bottom:calc(100% + 12px);width:360px;color:#586678}
.graph-health{display:flex;align-items:center;gap:6px;color:#637587}
.graph-health-dot{width:6px;height:6px;border-radius:50%;background:#8baaa0;flex-shrink:0}
.graph-health[data-warning=true] .graph-health-dot{background:#c69c57}
.graph-scopebar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 16px;background:#f6f4fb;border-bottom:1px solid #e9e4f3;font-size:12px;color:#75618e;flex-shrink:0}
.graph-scopebar button{border:0;background:transparent;min-height:24px;padding:2px 6px;font-size:11px}
.graph-notice{padding:8px 16px;margin:0;background:#fff7e8;color:#8c692d;font-size:12px}
.graph-footer{padding:10px 14px;border-top:1px solid var(--graph-border);background:#fff;flex-shrink:0}
.graph-legend{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0}.graph-legend i{display:inline-block;width:18px;border-top:2px solid #617291;vertical-align:middle;margin-right:5px}.graph-legend i[data-kind=contains]{border-top:2px dashed #697386}
@container(max-width:700px){.graph-toolbar{gap:8px;padding:10px 12px}.graph-title{font-size:14px}.graph-search{order:2;flex-basis:100%}.graph-settings-trigger{margin-left:0}.graph-settings-drawer{top:96px;right:8px;bottom:54px;width:310px}.graph-toolbar>.graph-popover{margin-left:auto}.graph-toolbar select{max-width:118px}.graph-statusbar{padding:7px 12px;gap:5px 10px}.graph-toolbar>.graph-popover,.graph-statusbar>.graph-popover{position:static}.graph-popover-body{right:12px}.graph-inspector{width:300px;top:8px;right:8px;bottom:68px}.graph-camera-tools{right:8px!important;bottom:8px!important}.graph-hint{display:none}}
@container(max-width:460px){.graph-inspector{top:auto;left:8px;right:8px;bottom:56px;width:auto;max-width:none;max-height:65%;padding:14px}.graph-toolbar>select{margin-left:auto}.graph-toolbar>.graph-popover{margin-left:0}.graph-statusbar .graph-popover{margin-left:0}}
`
