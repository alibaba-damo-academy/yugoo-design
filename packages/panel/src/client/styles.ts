/**
 * Design dock styles: the --ds-* token subset ported from extend-design-skill's
 * src/styles/token.css (scoped to the dock so the host page is untouched) plus
 * the generic dock, tabs, and footer chrome. Class names are prefixed
 * `dsh-design-` to stay collision-free inside the shell overlay layer.
 */

/** Shared popup styles, also usable by standalone browser control adapters.
 * PanelSelect carries these in its open Portal's DOM lifetime, so it does not
 * depend on a dock stylesheet or mutate the Host's global theme. */
export const PANEL_SELECT_MENU_CSS = `
.dsh-panel-select-content { z-index: var(--z-popover, 1100); box-sizing: border-box; min-width: var(--radix-select-trigger-width); max-width: calc(100vw - 16px); max-height: min(320px, var(--radix-select-content-available-height)); overflow: hidden; border: 1px solid var(--ds-border-default, #dfdfdf); border-radius: var(--ds-radius-4, 8px); background: var(--ds-bg-white, var(--ds-bg-container, #fff)); color: var(--ds-text-primary, #272727); box-shadow: var(--ds-shadow-2-center, 0 4px 16px rgb(0 0 0 / 14%)); }
.dsh-panel-select-viewport { padding: 4px; }
.dsh-panel-select-option { position: relative; display: flex; box-sizing: border-box; align-items: center; min-height: 32px; padding: 6px 28px 6px 8px; border-radius: 4px; font: inherit; line-height: 20px; overflow-wrap: anywhere; cursor: default; user-select: none; outline: none; }
.dsh-panel-select-option[data-highlighted] { background: var(--ds-brand-light-bg-default, #f7f4fe); color: var(--ds-brand-text-primary, #6849d8); }
.dsh-panel-select-option[data-disabled] { color: var(--ds-text-disabled, #b5b5b5); }
.dsh-panel-select-indicator { position: absolute; inset-inline-end: 8px; display: flex; align-items: center; color: var(--ds-brand-text-primary, #6849d8); }
.dsh-panel-select-scroll { display: flex; align-items: center; justify-content: center; height: 24px; }
`

/**
 * Token subset, Host-safe dock layering, tabs bar, and footer.
 *
 * The dock owns a low non-modal layer inside `shell.overlay`. While it is
 * open, that Host slot stops isolating z-order and the two containers around
 * the public `conversation` slot stop clipping native popups. Their own
 * z-index and pointer targets therefore remain above the dock.
 */
export const DOCK_CSS = `
.dsh-design-dock{
  --dsh-host-primary-header-height:76px;
  --dsh-host-secondary-nav-height:32px;
  --ds-brand-1:#f7f4fe;--ds-brand-2:#eae5ff;--ds-brand-3:#ddd3ff;--ds-brand-4:#b49fff;
  --ds-brand-6:#7c5af6;--ds-brand-7:#6849d8;--ds-brand-8:#5032bc;
  --ds-text-1:#e8e8e8;--ds-text-3:#c2c2c2;--ds-text-4:#b5b5b5;--ds-text-5:#a2a2a2;
  --ds-text-6:#929292;--ds-text-7:#6d6d6d;--ds-text-8:#4c4c4c;--ds-text-9:#272727;
  --ds-text-primary:#272727;--ds-text-secondary:#4c4c4c;--ds-text-tertiary:#6d6d6d;--ds-text-disabled:#b5b5b5;
  --ds-line-1:#e8e8e8;--ds-line-2:#dfdfdf;--ds-line-3:#cbcbcb;
  --ds-fill-1:#fbfbfb;--ds-fill-2:#f7f7f7;--ds-fill-3:#f3f3f3;--ds-fill-4:#f1f1f1;--ds-fill-5:#ebebeb;--ds-fill-6:#e8e8e8;
  --ds-icon-outline-muted:#a2a2a2;--ds-icon-fill-default:#929292;--ds-icon-outline-default:#6d6d6d;
  --ds-divider-default:#e8e8e8;--ds-border-default:#dfdfdf;
  --ds-success-6:#199b51;--ds-warning-5:#e17725;--ds-error-6:#d65350;--ds-error-7:#b02d2f;
  --ds-radius-1:2px;--ds-radius-2:4px;--ds-radius-3:6px;--ds-radius-4:8px;--ds-radius-6:12px;--ds-radius-8:16px;
  --ds-space-1:4px;--ds-space-2:8px;--ds-space-3:12px;--ds-space-4:16px;--ds-space-5:20px;--ds-space-6:24px;
  --ds-shadow-1-center:1px 1px 4px 0px rgba(0,0,0,0.1);
  --ds-shadow-1-down:0px 1px 4px 0px rgba(0,0,0,0.1);
  --ds-font-body-lv1:12px;--ds-font-body-lv2:14px;--ds-font-subhead:16px;
  color:var(--ds-text-primary);font-size:14px;
}
.dsh-design-frame-inset{padding-right:var(--dsh-design-dock-w)!important;box-sizing:border-box}
.dsh-design-frame-inset>[data-shell-overlay]{z-index:auto}
.dsh-design-frame-inset>:has(>[data-slot="conversation"]),
.dsh-design-frame-inset [data-slot="conversation"]>*{overflow:visible}
.dsh-design-dock{position:absolute;top:var(--dsh-design-dock-top,0px);right:0;bottom:0;width:var(--dsh-design-dock-w);
  display:flex;flex-direction:column;background:#fff;
  border-left:1px solid var(--ds-line-1);pointer-events:auto;z-index:1}
.dsh-design-dock-resize{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:col-resize;z-index:2;touch-action:none}
.dsh-design-dock-resize:hover{background:var(--ds-line-2)}
.dsh-design-dock-panels{flex:1;min-height:0;position:relative}
.dsh-design-dock-panel{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden}
.dsh-design-dock-panel[data-hidden]{display:none}
.dsh-design-dock-panel-body{flex:1;min-height:0;overflow-y:auto;padding:var(--ds-space-3) var(--ds-space-4)}
.dsh-design-workspace-inset .dsh-design-dock-panel-body:not(.dsh-design-dock-panel-workspace){padding:0 var(--ds-space-4) 0 0}
.dsh-design-dock-panel-body.dsh-design-dock-panel-workspace{height:100%;overflow:hidden;padding:0}
.dsh-design-dock-panel-workspace>.dsh-design-panel,
.dsh-design-dock-panel-workspace>.dsh-design-panel>.dsh-design-stack,
.dsh-design-dock-panel-workspace .dsh-design-question-workspace{height:100%;min-height:0}
.dsh-design-dock-empty{padding:var(--ds-space-5);color:var(--ds-text-tertiary);font-size:var(--ds-font-body-lv2)}
.dsh-design-project-header{display:flex;min-width:0;
  min-height:var(--dsh-host-primary-header-height,76px);flex:0 0 auto;
  align-items:center;gap:12px;box-sizing:border-box;padding:4px var(--ds-space-4,16px);background:#fff;
  border-bottom:1px solid var(--ds-line-1,#e8e8e8);text-align:left}
.dsh-design-project-header[data-testid="design-project-header"]{min-height:64px;padding:6px var(--ds-space-4,16px)}
.dsh-design-project-header>[data-testid="design-dock-meta"]{flex:1;align-items:flex-start}
.dsh-design-project-header>.dsh-design-dock-close{align-self:flex-start}
.dsh-design-dock-meta{display:flex;min-width:0;flex-direction:column;justify-content:center;gap:4px}
.dsh-design-dock-meta>div{margin:0;min-height:20px;line-height:20px}
.dsh-design-project-identity{display:flex;align-items:center;gap:6px;width:100%;min-width:0;font-size:13px;color:var(--ds-text-secondary)}
.dsh-design-project-identity>[data-testid="design-dock-meta-name"]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-design-project-folder{display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--ds-text-tertiary);cursor:pointer}
.dsh-design-project-folder:hover{background:var(--ds-fill-3);color:var(--ds-text-primary)}
.dsh-design-project-folder:focus-visible{outline:2px solid var(--ds-brand-6);outline-offset:1px}
.dsh-design-project-folder:disabled{cursor:wait;opacity:.55}
.dsh-design-project-folder-error{color:var(--ds-error-6);font-size:12px;line-height:20px}
.dsh-design-dock .dsh-design-project-header[data-testid="design-project-header"]:not([data-compact=true]){
  position:relative;height:var(--dsh-host-primary-header-height,64px);min-height:var(--dsh-host-primary-header-height,64px);
  padding-block:0;border-bottom-width:.5px}
.dsh-design-dock .dsh-design-project-header[data-testid="design-project-header"]:not([data-compact=true])>[data-testid="design-dock-meta"]{gap:2px}
.dsh-design-dock .dsh-design-project-header[data-testid="design-project-header"]:not([data-compact=true]) .dsh-design-project-folder{width:24px;height:24px}
.dsh-design-dock .dsh-design-project-header[data-testid="design-project-header"]:not([data-compact=true]) .dsh-design-project-folder-error{
  position:absolute;top:calc(100% + 1px);left:0;right:0;z-index:1;padding:4px 16px;background:#fff;border-bottom:1px solid var(--ds-line-1,#e8e8e8)}
.dsh-current-project-trigger{display:flex;align-items:center;gap:10px;min-height:40px;width:100%;padding:0 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer}
.dsh-current-project-trigger[data-wide=false]{width:36px;justify-content:center;padding:0}
.dsh-current-project-trigger svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.dsh-current-project-trigger:hover{background:var(--ds-fill-3,#f3f0f8)}
.dsh-current-project-trigger[aria-expanded=true]{background:var(--ds-brand-1,#f1ecff);color:var(--ds-brand-7,#663ae8)}
.dsh-current-project-trigger:focus-visible{outline:2px solid var(--ds-brand-6,#7c5af6);outline-offset:2px}
.dsh-current-project-info{position:fixed;z-index:900;box-sizing:border-box;max-height:calc(100vh - 24px);overflow:auto;padding:16px;border:1px solid var(--ds-line-2,#dfdfdf);border-radius:8px;background:var(--ds-bg-container,#fff);color:var(--ds-text-primary,#272727);box-shadow:0 8px 28px rgb(0 0 0 / 14%);font-size:13px;line-height:20px}
.dsh-current-project-info>header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.dsh-current-project-info>header>strong{font-size:14px;font-weight:500}
.dsh-current-project-info>header>button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;font-size:20px;cursor:pointer}
.dsh-current-project-info>header>button:hover{background:var(--ds-fill-3,#f3f3f3)}
.dsh-current-project-info:focus-visible,.dsh-current-project-info button:focus-visible{outline:2px solid var(--ds-brand-6,#7c5af6);outline-offset:2px}
.dsh-current-project-info .dsh-design-dock-meta{gap:12px}
.dsh-current-project-info .dsh-design-dock-meta>div{white-space:normal;overflow:visible;overflow-wrap:anywhere}
.dsh-current-project-info .dsh-clarity-dock-dims{margin-inline-start:0;flex:1 0 100%;max-width:none}
.dsh-current-project-info .dsh-clarity-dock-dim{min-width:80px}
.dsh-design-project-header[data-compact=true]{height:44px;min-height:44px;padding:0 var(--ds-space-3,12px)}
.dsh-design-project-header[data-compact=true]>.dsh-design-dock-meta{flex-direction:row;align-items:center;justify-content:space-between;gap:12px}
.dsh-design-compact-project{display:flex;align-items:center;gap:6px;min-width:0;margin-left:auto!important;white-space:nowrap;font-size:13px;color:var(--ds-text-secondary)}
.dsh-design-compact-project>[data-testid="design-dock-meta-name"]{overflow:hidden;text-overflow:ellipsis}
.dsh-design-view-switcher{display:flex;flex:0 0 auto;min-width:0;gap:4px;justify-content:flex-start}
.dsh-design-view-footer{flex:0 0 auto;padding:16px;border-top:1px solid var(--ds-line-1);background:#fff}
.dsh-design-footer-with-views.dsh-design-footer-with-views{flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.dsh-design-footer-with-views>div{min-width:0;max-width:100%;flex-shrink:1}
.dsh-design-footer-with-views>div:last-child{flex-direction:row;align-items:center;justify-content:flex-end;margin-left:auto}
.dsh-design-footer-actions{display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;justify-content:flex-end;gap:8px;min-width:0;max-width:100%}
.dsh-design-footer-actions>button{width:auto;min-width:0;flex:0 1 auto;height:auto;min-height:32px;white-space:normal}
.dsh-design-footer-with-views .dsh-design-view-switcher{flex-wrap:wrap;max-width:100%}
.dsh-design-footer-with-views>div:last-child>button{max-width:100%;height:auto;min-height:32px;white-space:normal}
.dsh-design-view-switcher>button{flex:0 0 auto;white-space:nowrap;padding:5px 10px;border:0;border-radius:6px;
  background:transparent;color:var(--ds-text-secondary);font-size:13px;line-height:20px;cursor:pointer}
.dsh-design-view-switcher>button[aria-pressed="true"]{background:var(--ds-fill-3);color:var(--ds-text-primary);font-weight:500}
.dsh-design-view-switcher>button:hover{background:var(--ds-fill-5)}

/* ---- tabs bar: Chrome-style tab strip (DesignTabsBar replica) ---- */
@keyframes dsh-flash-out{0%{opacity:1}70%{opacity:1}100%{opacity:0}}
.dsh-design-tabs{position:relative;display:flex;width:100%;min-width:0;box-sizing:border-box;
  align-items:flex-end;background:var(--ds-fill-3);padding:6px 6px 0}
.dsh-design-tabs-scroll{display:flex;min-width:0;flex:1;align-items:flex-end;gap:2px;overflow-x:auto;
  scrollbar-width:none;-ms-overflow-style:none}
.dsh-design-tabs-scroll::-webkit-scrollbar{display:none}
.dsh-design-tab{position:relative;display:flex;height:var(--dsh-host-secondary-nav-height);max-width:190px;flex-shrink:0;
  align-items:center;gap:8px;box-sizing:border-box;font-size:13px;font-weight:400;line-height:20px;
  border:none;border-radius:8px 8px 0 0;cursor:pointer;transition:background-color .15s,color .15s;
  background:transparent;color:var(--ds-text-7);padding:0 12px}
.dsh-design-tab:hover{background:var(--ds-fill-5);color:var(--ds-text-primary)}
.dsh-design-tab[data-state=active]{background:#fff;color:var(--ds-text-9)}
.dsh-design-tab[data-state=active]:hover{background:#fff}
.dsh-design-tab-icon{width:14px;height:14px;flex-shrink:0;color:rgba(16,8,43,0.48)}
.dsh-design-tab[data-state=active] .dsh-design-tab-icon{color:var(--ds-text-primary)}
.dsh-design-tab-badge{position:absolute;right:4px;top:7px;height:6px;width:6px;border-radius:50%;
  background:var(--ds-icon-outline-muted)}
.dsh-design-tab-new{position:absolute;right:-4px;top:0;border-radius:999px;background:var(--ds-brand-6);
  padding:0 4px;font-size:10px;line-height:14px;color:#fff}
.dsh-design-tab-new[data-flash]{animation:dsh-flash-out 1.5s ease-out forwards}
.dsh-design-tabs-more{position:relative;order:-1;margin-right:2px;flex-shrink:0;align-self:flex-end}
.dsh-design-tabs-more>button{display:flex;width:26px;height:26px;align-items:center;justify-content:center;
  border:none;background:transparent;border-radius:50%;color:var(--ds-text-7);cursor:pointer;margin-bottom:3px}
.dsh-design-tabs-add{display:flex;width:26px;height:26px;align-items:center;justify-content:center;flex-shrink:0;
  border:none;background:transparent;border-radius:50%;color:var(--ds-text-7);cursor:pointer;
  margin:0 2px 3px;padding:0}
.dsh-design-tabs-more>button:hover,.dsh-design-tabs-add:hover{background:var(--ds-fill-5);color:var(--ds-text-primary)}
.dsh-design-dock-close{display:flex;width:26px;height:26px;align-items:center;justify-content:center;flex-shrink:0;
  align-self:flex-end;border:none;background:transparent;border-radius:50%;color:var(--ds-text-7);
  cursor:pointer;font-size:16px;line-height:1;margin:0 6px 3px 2px;padding:0}
.dsh-design-dock-close:hover{background:var(--ds-fill-5);color:var(--ds-text-primary)}
.dsh-execution-log-toggle{appearance:none;outline:none}
.dsh-execution-log-toggle:focus-visible{outline:none;border-radius:7px;
  box-shadow:inset 0 0 0 2px var(--dsw-alias-state-business-primary,#7c5af6)}
.dsh-design-tabs-menu{position:absolute;left:0;top:100%;z-index:20;margin-top:4px;max-height:60vh;min-width:180px;
  overflow-y:auto;border-radius:var(--ds-radius-4);border:1px solid var(--ds-line-1);
  background:var(--ds-fill-1);padding:4px 0;box-shadow:var(--ds-shadow-1-down)}
.dsh-design-tabs-menu button{display:flex;width:100%;align-items:center;gap:8px;padding:8px 12px;border:none;
  background:transparent;text-align:left;font-size:var(--ds-font-body-lv2);color:var(--ds-text-7);cursor:pointer}
.dsh-design-tabs-menu button:hover{background:var(--ds-fill-3)}
.dsh-design-tabs-menu button[data-active]{color:var(--ds-text-primary)}
.dsh-design-tabs-menu .dsh-design-tab-new{position:static;margin-left:auto}
.dsh-design-tabs-menu .dsh-design-tab-badge{position:static;margin-left:auto}

/* ---- footer (FooterButtons replica) ---- */
.dsh-design-footer{position:relative;display:flex;align-items:center;gap:var(--ds-space-4);
  background:#fff;padding:var(--ds-space-4);border-top:1px solid var(--ds-divider-default);justify-content:flex-end}
.dsh-design-footer-left{display:flex;align-items:center;gap:var(--ds-space-2);margin-right:auto;
  color:var(--ds-text-tertiary);font-size:var(--ds-font-body-lv1)}
.dsh-design-footer .dsh-design-btn{padding:6px 16px;border-radius:var(--ds-radius-4);font-size:var(--ds-font-body-lv2);
  cursor:pointer;line-height:20px;border:1px solid var(--ds-border-default);background:#fff;color:var(--ds-text-primary)}
.dsh-design-footer .dsh-design-btn:hover:not(:disabled){background:var(--ds-fill-2)}
.dsh-design-footer .dsh-design-btn:disabled{color:var(--ds-text-disabled);cursor:not-allowed}
.dsh-design-footer .dsh-design-btn-primary{background:var(--ds-brand-6);border-color:var(--ds-brand-6);color:#fff}
.dsh-design-footer .dsh-design-btn-primary:hover:not(:disabled){background:var(--ds-brand-7)}
.dsh-design-footer .dsh-design-btn-primary:disabled{background:var(--ds-brand-3);border-color:var(--ds-brand-3)}
.dsh-design-save-error{color:var(--ds-error-7);font-size:var(--ds-font-body-lv1);max-width:220px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

`

/** Host-composer advisory review cards; independent of the Design dock. */
export const ADVISORY_CSS = `
.dsh-design-sidebar-actions{display:flex;flex-direction:column;align-items:stretch;width:100%;min-width:0}
.dsh-design-sidebar-actions-rail{width:36px;align-items:center}
.dsh-project-sidebar-entry{position:relative;flex:none;width:100%;min-width:0;margin:4px 0}
.dsh-project-sidebar-trigger{display:flex;box-sizing:border-box;width:calc(100% + 4px);height:42px;margin:0 -2px;align-items:center;gap:8px;overflow:hidden;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,#0f172a);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-project-sidebar-trigger:hover,.dsh-project-sidebar-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}
.dsh-project-sidebar-icon{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.5}
.dsh-project-sidebar-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-project-sidebar-entry-rail{width:36px;margin:0}.dsh-project-sidebar-entry-rail .dsh-project-sidebar-trigger{width:36px;height:36px;justify-content:center;gap:0;margin:0;padding:0;border-radius:50%}
.dsh-project-catalog{position:fixed;z-index:1000;display:flex;width:360px;max-width:calc(100vw - 16px);max-height:min(70vh,620px);box-sizing:border-box;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-normal,#e2e8f0);border-radius:12px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f172a);box-shadow:0 12px 32px rgba(15,23,42,.16);font-family:inherit}
.dsh-project-catalog-header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-normal,#e2e8f0)}
.dsh-project-catalog-header>div,.dsh-project-mindset>div{display:flex;min-width:0;flex-direction:column}.dsh-project-catalog-header strong,.dsh-project-mindset strong{font-size:14px}.dsh-project-catalog-header span,.dsh-project-mindset span{color:var(--dsw-alias-label-tertiary,#64748b);font-size:11px}
.dsh-project-catalog-header button{display:flex;width:28px;height:28px;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer}.dsh-project-catalog-header button:hover{background:var(--dsw-alias-bg-secondary,#f1f5f9)}.dsh-project-catalog-header svg{width:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.dsh-project-create{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-normal,#e2e8f0)}.dsh-project-create input{min-width:0;flex:1;padding:7px 9px;border:1px solid var(--dsw-alias-border-normal,#cbd5e1);border-radius:7px;background:#fff;color:inherit;font:inherit;font-size:13px}.dsh-project-create button,.dsh-project-mindset button{border:1px solid var(--dsw-alias-state-business-primary,#2563eb);border-radius:7px;background:var(--dsw-alias-state-business-primary,#2563eb);color:#fff;padding:6px 10px;font:inherit;font-size:12px;cursor:pointer}.dsh-project-create button:disabled,.dsh-project-mindset button:disabled{cursor:default;opacity:.45}
.dsh-project-list{min-height:80px;overflow-y:auto;padding:5px}.dsh-project-row{display:flex;align-items:center;gap:6px;border-radius:8px}.dsh-project-row:hover,.dsh-project-row[data-current]{background:var(--dsw-alias-bg-secondary,#f8fafc)}.dsh-project-open{display:flex;min-width:0;flex:1;flex-direction:column;align-items:flex-start;padding:8px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.dsh-project-open:disabled{cursor:default}.dsh-project-name{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}.dsh-project-meta{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#64748b);font-size:11px}
.dsh-project-recover,.dsh-project-delete{border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#64748b);padding:5px 7px;font:inherit;font-size:11px;cursor:pointer}.dsh-project-recover:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9);color:var(--dsw-alias-state-business-primary,#2563eb)}.dsh-project-recover:disabled{cursor:default;opacity:.4}.dsh-project-delete:hover{background:#fee2e2;color:#b91c1c}.dsh-project-delete-confirm{background:#b91c1c!important;color:#fff!important}
.dsh-project-mindset{display:grid;grid-template-columns:minmax(0,1fr) minmax(90px,130px) auto;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-normal,#e2e8f0)}.dsh-project-mindset select{min-width:0;padding:6px 7px;border:1px solid var(--dsw-alias-border-normal,#cbd5e1);border-radius:7px;background:#fff;color:inherit;font:inherit;font-size:12px}.dsh-project-catalog-empty{padding:24px;color:var(--dsw-alias-label-tertiary,#64748b);font-size:13px;text-align:center}.dsh-project-catalog-error{padding:7px 12px;border-top:1px solid #fecaca;background:#fef2f2;color:#b91c1c;font-size:11px}
.dsh-advisory-sidebar-entry{position:relative;flex:none;width:100%;min-width:0;margin:4px 0}
.dsh-advisory-sidebar-trigger{position:relative;display:flex;box-sizing:border-box;width:calc(100% + 4px);height:42px;margin:0 -2px;
  align-items:center;gap:8px;overflow:hidden;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;
  color:var(--dsw-alias-label-primary,#0f172a);font:inherit;font-size:14px;line-height:22px;cursor:pointer;text-align:start}
.dsh-advisory-sidebar-trigger:hover,.dsh-advisory-sidebar-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}
.dsh-advisory-sidebar-trigger:disabled{cursor:default;opacity:.65}
.dsh-advisory-sidebar-icon{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.5}
.dsh-advisory-sidebar-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-advisory-sidebar-badge{display:inline-flex;min-width:20px;height:18px;flex:none;align-items:center;justify-content:center;box-sizing:border-box;
  margin-left:auto;padding:0 5px;border-radius:9px;background:#b45309;color:#fff;font-size:10px;font-weight:700;font-variant-numeric:tabular-nums}
.dsh-advisory-sidebar-entry[data-empty] .dsh-advisory-sidebar-trigger{color:var(--dsw-alias-label-tertiary,#64748b)}
.dsh-advisory-sidebar-entry[data-empty] .dsh-advisory-sidebar-badge{background:var(--dsw-alias-bg-secondary,#f1f5f9);color:var(--dsw-alias-label-caption,#94a3b8)}
.dsh-advisory-sidebar-entry-rail{width:36px;margin:0}
.dsh-advisory-sidebar-entry-rail .dsh-advisory-sidebar-trigger{width:36px;height:36px;justify-content:center;gap:0;margin:0;padding:0;border-radius:50%;overflow:visible}
.dsh-advisory-composer-entry{align-self:center;width:auto;max-width:220px}
.dsh-advisory-composer-entry .dsh-advisory-sidebar-trigger{width:auto;min-width:28px;max-width:220px;height:28px;justify-content:flex-start;gap:4px;padding:0 4px 0 8px;border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-label-secondary,#61666b);font-size:13px;line-height:20px;font-weight:500}
.dsh-advisory-composer-entry .dsh-advisory-sidebar-icon{width:14px;height:14px}
.dsh-advisory-composer-entry:has(.dsh-advisory-sidebar-badge,.dsh-advisory-sidebar-activity:not(:empty)) .dsh-advisory-sidebar-label{padding-right:12px}
.dsh-advisory-composer-entry .dsh-advisory-sidebar-trigger:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#2563eb));outline-offset:2px}
/* The Host composer row already owns this anonymous size container, shared
   with PermissionSelect. Collapse only this entry's label, never by viewport. */
@container (max-width:460px){.dsh-advisory-composer-entry .dsh-advisory-sidebar-label{display:none}}
.dsh-advisory-sidebar-entry-rail .dsh-advisory-sidebar-badge{position:absolute;right:-5px;top:-4px;min-width:16px;height:16px;padding:0 4px;border:2px solid var(--dsw-specific-sidebar-fill,#fff);font-size:9px}
.dsh-advisory-sidebar-entry[data-review-phase=running] .dsh-advisory-sidebar-icon{color:var(--ds-brand-text-primary,#7c3aed);animation:dsh-advisory-review-pulse 1.8s ease-in-out infinite}
.dsh-advisory-sidebar-activity{display:inline-flex;align-items:center;gap:4px;min-width:0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,#475569)}
.dsh-advisory-sidebar-activity:empty{display:none}
.dsh-advisory-sidebar-activity-icon{display:inline-flex;flex:none;align-items:center;line-height:0}
.dsh-advisory-sidebar-activity-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-advisory-sidebar-entry:not(.dsh-advisory-sidebar-entry-rail)[data-review-phase]:not([data-review-phase=idle]) .dsh-advisory-sidebar-trigger{display:grid;grid-template-columns:18px minmax(0,1fr) auto;grid-template-rows:20px 16px;column-gap:8px;row-gap:0}
.dsh-advisory-sidebar-entry:not(.dsh-advisory-sidebar-entry-rail) .dsh-advisory-sidebar-icon{grid-row:1/3}
.dsh-advisory-sidebar-entry:not(.dsh-advisory-sidebar-entry-rail) .dsh-advisory-sidebar-activity{grid-column:2;grid-row:2}
.dsh-advisory-sidebar-entry:not(.dsh-advisory-sidebar-entry-rail) .dsh-advisory-sidebar-badge{grid-column:3;grid-row:1/3}
/* Composer reuses rail label/count behavior, but its activity stays centered in the button's flex row. */
.dsh-advisory-sidebar-entry-rail:not(.dsh-advisory-composer-entry) .dsh-advisory-sidebar-activity:not(:empty){position:absolute;right:-3px;bottom:0;padding:1px;border-radius:50%;background:var(--dsw-specific-sidebar-fill,#fff)}
.dsh-advisory-sidebar-entry-rail .dsh-advisory-sidebar-activity-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@keyframes dsh-advisory-review-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@media(prefers-reduced-motion:reduce){.dsh-advisory-sidebar-entry[data-review-phase=running] .dsh-advisory-sidebar-icon,.dsh-advisory-sidebar-activity .animate-spin{animation:none}}
.dsh-advisory-empty{padding:16px 4px;color:var(--dsw-alias-label-tertiary,#64748b);font-size:13px;text-align:center}
.dsh-advisory-inbox-title{display:flex;align-items:center;gap:8px}
.dsh-advisory-inbox-actions{display:flex;align-items:center;gap:8px}
.dsh-advisory-inbox-close{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#475569);font-size:20px;line-height:1;cursor:pointer}
.dsh-advisory-inbox-close:hover{background:var(--dsw-alias-bg-secondary,#f1f5f9)}
.dsh-advisory-inbox-close:focus-visible{outline:2px solid var(--ds-brand-6,#663ae8);outline-offset:2px}
.dsh-review-settings{margin:0;display:inline-flex}
.dsh-review-settings-trigger{display:inline;width:auto;padding:2px 0;border:0;background:transparent;color:var(--ds-brand-6,#663ae8);font:inherit;font-size:12px;font-weight:400;white-space:nowrap;cursor:pointer;text-underline-offset:3px}
.dsh-review-settings-trigger:hover{text-decoration:underline}
.dsh-review-settings-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:360px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 48px);overflow:auto;padding:20px;border:1px solid var(--dsw-alias-border-normal,#e2e8f0);border-radius:14px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f172a);box-shadow:0 20px 70px rgba(15,23,42,.22);font-size:13px;line-height:1.5}
.dsh-review-settings-dialog::backdrop{background:rgba(15,23,42,.3)}
.dsh-review-settings-dialog:not([open]){display:none}
.dsh-review-settings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
.dsh-review-settings-header h2{margin:0;font-size:15px;font-weight:600}
.dsh-review-settings-header p,.dsh-review-settings-help{margin:6px 0 0;color:var(--dsw-alias-label-tertiary,#64748b);font-size:12px;line-height:1.6}
.dsh-review-settings-close{flex:none;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#475569);font-size:20px;cursor:pointer}
.dsh-review-settings-fields{display:flex;flex-direction:column;gap:14px}
.dsh-review-settings-fields label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:500}
.dsh-review-settings-fields input,.dsh-review-settings-fields select{box-sizing:border-box;width:100%;min-width:0;height:36px;padding:7px 10px;border:1px solid var(--dsw-alias-border-normal,#cbd5e1);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f172a);font:inherit;font-weight:400}
.dsh-review-settings-fields select{appearance:auto}
.dsh-review-settings-actions{display:flex;gap:8px;margin-top:4px;flex-wrap:wrap}
.dsh-review-settings-actions button{flex:1;min-width:110px;padding:8px 10px;border:1px solid var(--dsw-alias-border-normal,#cbd5e1);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f172a);font:inherit;font-size:12px;cursor:pointer}
.dsh-review-settings-actions .dsh-review-settings-save{border-color:var(--ds-brand-6,#663ae8);background:var(--ds-brand-6,#663ae8);color:#fff}
.dsh-review-settings-dialog button:disabled,.dsh-review-settings-dialog input:disabled,.dsh-review-settings-dialog select:disabled{opacity:.5;cursor:not-allowed}
.dsh-review-settings-dialog :is(button,input,select):focus-visible,.dsh-review-settings-trigger:focus-visible{outline:2px solid var(--ds-brand-6,#663ae8);outline-offset:2px}
.dsh-review-settings-close:hover{background:var(--dsw-alias-bg-secondary,#f1f5f9)}
.dsh-review-settings-error,.dsh-review-settings-notice{margin-top:12px;padding:9px 10px;border-radius:7px;font-size:12px;overflow-wrap:anywhere}
.dsh-review-settings-error{background:#fef2f2;color:#b91c1c}
.dsh-review-settings-notice{background:#f0fdf4;color:#166534}
.dsh-advisory-inbox{box-sizing:border-box;min-inline-size:0;
  inline-size:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px));
  max-inline-size:var(--dsh-composer-card-max-width,780px);align-self:center;
  max-height:min(42vh,420px);overflow-y:auto;margin:0 0 8px;padding:8px;border:1px solid var(--dsw-alias-border-normal,#e2e8f0);
  border-radius:12px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 8px 24px rgba(15,23,42,.12)}
.dsh-advisory-inbox-heading{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 8px;color:var(--dsw-alias-label-secondary,#475569);
  font-size:12px;font-weight:600}
.dsh-advisory-sidebar-popover{position:fixed;z-index:var(--z-popover,1100);box-sizing:border-box;
  display:flex;min-width:0;min-height:0;width:min(560px,calc(100vw - 24px));max-height:calc(100dvh - 24px);
  font:400 14px/1.5 var(--ds-font-main,system-ui,sans-serif)}
.dsh-advisory-sidebar-popover>.dsh-advisory-inbox{display:flex;min-height:0;flex-direction:column;
  inline-size:100%;max-inline-size:none;max-height:inherit;margin:0}
.dsh-advisory-sidebar-popover .dsh-advisory-inbox-heading,.dsh-advisory-sidebar-popover .dsh-review-settings{flex-shrink:0}
.dsh-advisory-sidebar-popover .dsh-advisory-review{min-height:0}
.dsh-advisory-sidebar-popover .dsh-advisory-card{max-height:none;flex:0 1 auto}
.dsh-advisory-review{display:flex;min-width:0;flex-direction:column;overflow-x:hidden}
.dsh-advisory-carousel{display:flex;min-width:0;min-height:0;flex-direction:column;gap:6px}
.dsh-advisory-carousel-controls{display:flex;flex:0 0 auto;align-items:center;justify-content:center;gap:6px;padding:0 2px}
.dsh-advisory-carousel-controls button{display:inline-flex;width:28px;height:26px;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-normal,#cbd5e1);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f172a);font-size:14px;cursor:pointer}
.dsh-advisory-carousel-controls button:disabled{cursor:not-allowed;opacity:.4}.dsh-advisory-position{min-width:44px;text-align:center;color:var(--dsw-alias-label-tertiary,#64748b);font-size:12px;font-variant-numeric:tabular-nums}
.dsh-advisory-card{display:flex;max-height:min(38vh,360px);min-height:0;flex-direction:column;overflow:hidden;padding:10px 12px;
  border:1px solid #f0c36d;border-radius:10px;background:var(--dsw-alias-bg-base,#fff);
  font:400 14px/1.5 var(--ds-font-main,system-ui,sans-serif);overflow-wrap:anywhere}
.dsh-advisory-card-header,.dsh-advisory-actions{display:flex;align-items:center;gap:8px}
.dsh-advisory-profile{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#64748b);font-size:12px}
.dsh-advisory-kind{font-size:12px;color:#9a6700}
.dsh-advisory-card-header{flex-wrap:wrap}
.dsh-advisory-time{margin-right:auto;font-size:11px;color:var(--ds-text-7,#6b7280);white-space:nowrap}
.dsh-advisory-unread{font-size:11px;color:var(--ds-brand-6,#663ae8)}
.dsh-advisory-new-arrival{flex:0 1 auto;max-width:100%;min-height:24px;border:0;border-radius:4px;padding:2px 4px;background:transparent;color:var(--ds-brand-6,#663ae8);font:inherit;font-size:12px;overflow-wrap:anywhere;text-align:start;cursor:pointer}
.dsh-advisory-new-arrival:hover{text-decoration:underline}
.dsh-advisory-new-arrival:focus-visible{outline:2px solid var(--ds-brand-6,#663ae8);outline-offset:2px}
.dsh-advisory-status,.dsh-advisory-revalidation{border-radius:999px;background:#eef2ff;padding:2px 6px;color:#4338ca;font-size:11px;white-space:nowrap}
.dsh-advisory-revalidation{background:#fff7ed;color:#9a3412}
.dsh-advisory-summary{max-height:84px;min-height:0;overflow-y:auto;margin:8px 0 6px;font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary,#0f172a)}
.dsh-advisory-details{min-height:0;color:var(--dsw-alias-label-secondary,#475569);font-size:14px}
.dsh-advisory-details>summary{display:flex;align-items:center;gap:7px;width:max-content;max-width:100%;padding:3px 0;color:var(--dsw-alias-state-business-primary,#2563eb);font-weight:600;cursor:pointer;list-style:none}
.dsh-advisory-details>summary::-webkit-details-marker{display:none}.dsh-advisory-details>summary:before{content:'›';font-size:16px;line-height:1;transition:transform .15s ease}
.dsh-advisory-details[open]>summary:before{transform:rotate(90deg)}
.dsh-advisory-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 5px;border-radius:9px;background:var(--dsw-alias-bg-secondary,#f1f5f9);color:var(--dsw-alias-label-tertiary,#64748b);font-size:11px}
.dsh-advisory-items-scroll{max-height:min(22vh,190px);overflow-y:auto;overscroll-behavior-y:contain;margin:5px 0 0;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f8fafc)}
.dsh-advisory-items{margin:0;padding:12px 12px 12px 28px;color:var(--dsw-alias-label-secondary,#475569);font-size:14px;line-height:22px}
.dsh-advisory-item+.dsh-advisory-item{margin-top:16px}.dsh-advisory-item span{display:block}.dsh-advisory-item-title{font-weight:500;color:var(--dsw-alias-label-primary,#0f172a)}.dsh-advisory-item-detail{margin-top:4px}.dsh-advisory-item-rationale{margin-top:4px;color:var(--dsw-alias-label-tertiary,#64748b);font-size:12px;line-height:20px}
.dsh-advisory-actions{flex:0 0 auto;flex-wrap:wrap;margin:8px -12px -10px;padding:8px 12px 10px;border-top:1px solid var(--dsw-alias-border-normal,#e2e8f0);
  background:var(--dsw-alias-bg-base,#fff)}
.dsh-advisory-actions button{border:1px solid var(--dsw-alias-border-normal,#cbd5e1);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);
  color:var(--dsw-alias-label-primary,#0f172a);padding:5px 10px;font:inherit;cursor:pointer}.dsh-advisory-actions button:disabled{cursor:wait;opacity:.55}
.dsh-advisory-actions .dsh-advisory-accept{border-color:var(--dsw-alias-state-business-primary,#2563eb);background:var(--dsw-alias-state-business-primary,#2563eb);color:#fff}
.dsh-advisory-error{margin:6px 0;color:#b91c1c;font-size:12px}
.dsh-advisory-expanded-layer{position:fixed;z-index:8;box-sizing:border-box;padding:12px 0;
  display:flex;flex-direction:column;justify-content:flex-end;pointer-events:none}
.dsh-advisory-expanded-layer>.dsh-advisory-carousel{max-height:100%;pointer-events:auto;background:var(--dsw-alias-bg-base,#fff);border-radius:10px}
.dsh-advisory-expanded-layer .dsh-advisory-card{min-height:0;max-height:none;flex:0 1 auto;box-sizing:border-box;box-shadow:0 12px 32px rgba(15,23,42,.14)}
.dsh-advisory-card[data-expanded] .dsh-advisory-summary{max-height:120px;flex:0 0 auto}
.dsh-advisory-card[data-expanded] .dsh-advisory-details{display:flex;min-height:0;flex:1;flex-direction:column;overflow:hidden}
.dsh-advisory-card[data-expanded] .dsh-advisory-details::details-content{display:flex;min-height:0;flex:1;flex-direction:column;overflow:hidden}
.dsh-advisory-card[data-expanded] .dsh-advisory-items-scroll{min-height:0;max-height:none;flex:1;overflow-y:auto}
`

/** Host-composer native continuation bar; independent of the Design dock. */
export const CONTINUATION_CSS = `
.dsh-design-continuation{box-sizing:border-box;display:flex;min-inline-size:0;
  inline-size:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px));
  max-inline-size:var(--dsh-composer-card-max-width,780px);align-self:center;align-items:center;flex-wrap:wrap;
  gap:10px;margin:0 0 8px;padding:8px 12px;
  border:1px solid var(--dsw-alias-border-normal,#e2e8f0);border-left:3px solid var(--dsw-alias-state-business-primary,#2563eb);
  border-radius:10px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 4px 16px rgba(15,23,42,.08)}
.dsh-design-continuation-text{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px;
  color:var(--dsw-alias-label-primary,#0f172a);font-size:13px;line-height:18px}
.dsh-design-continuation-skill{color:var(--dsw-alias-label-tertiary,#64748b);font-size:11px;font-weight:600}
.dsh-design-continuation-actions{display:flex;max-inline-size:100%;flex:0 1 auto;align-items:center;flex-wrap:wrap;gap:6px}
.dsh-design-continuation-actions button{border:1px solid var(--dsw-alias-border-normal,#cbd5e1);border-radius:7px;
  background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f172a);
  padding:4px 10px;font-size:12px;cursor:pointer}
.dsh-design-continuation-actions button:hover{background:var(--dsw-alias-bg-secondary,#f8fafc)}
.dsh-design-continuation-continue{border-color:var(--dsw-alias-state-business-primary,#2563eb)!important;
  background:var(--dsw-alias-state-business-primary,#2563eb)!important;color:#fff!important}
.dsh-design-continuation-continue:hover{opacity:.9;background:var(--dsw-alias-state-business-primary,#2563eb)}
`

/** Toggle styles inject once at boot: the toggle renders with the dock closed. */
export const TOGGLE_CSS = `
.dsh-design-toggle{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:30px;flex:0 0 auto;
  color:var(--dsw-alias-label-secondary,#64748b);cursor:pointer;background:transparent;border:0;border-radius:6px;
  padding:4px 8px;font:inherit;font-size:13px;line-height:20px;white-space:nowrap;-webkit-app-region:no-drag}
.dsh-design-toggle:hover{background:var(--dsw-alias-bg-secondary,#f1f5f9)}
.dsh-design-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3b82f6);outline-offset:2px}
.dsh-design-toggle-active{color:var(--dsw-alias-state-business-primary,#3b82f6);background:var(--dsw-alias-bg-secondary,#f1f5f9)}
.dsh-design-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);max-width:520px;pointer-events:none;
  padding:10px 16px;border-radius:8px;background:rgba(39,39,39,0.92);color:#fff;font-size:13px;line-height:1.6;
  z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2);white-space:pre-wrap;animation:dsh-design-toast-in .2s ease-out}
.dsh-design-toast-error{background:rgba(176,45,47,0.95)}
@keyframes dsh-design-toast-in{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%)}}
`
