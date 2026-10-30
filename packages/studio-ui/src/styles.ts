/**
 * Scoped responsive stylesheet for the shared Studio workspace.
 *
 * Composition follows the approved compact Studio demo; control typography,
 * purple brand accents, neutral text and radii follow the Yugoo UI. The stylesheet is scoped so
 * embedded and Companion hosts share it without importing a host/Core theme.
 */
import { CONVERSATION_ACTIVITY_CSS } from './ConversationActivity.tsx'
export const STUDIO_WORKSPACE_CSS = `
${CONVERSATION_ACTIVITY_CSS}
.ygd-studio-instance textarea:focus-visible{outline:2px solid var(--ds-primary);outline-offset:-2px}.ygd-studio-instance .ygd-studio-instance-pencil{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;background:transparent;border-radius:6px;color:var(--ds-text-secondary);cursor:pointer}.ygd-studio-instance .ygd-studio-instance-pencil:hover{background:var(--ds-primary-light);color:var(--ds-primary)}
.ygd-studio-notice,.ygd-studio-notice-reopen{font:12px/1.6 var(--ds-body-font);color:var(--ds-text-secondary);min-width:0;overflow-wrap:anywhere}
.ygd-studio-notice-notice{margin:8px 0;padding:10px 12px;border:1px solid var(--ds-border);border-radius:var(--ds-radius);background:var(--ds-surface)}
.ygd-studio-notice-heading,.ygd-studio-notice-reopen{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.ygd-studio-notice-title{display:block;font:12px/1.6 var(--ds-body-font);margin:0;overflow-wrap:anywhere}
.ygd-studio-notice[data-tone=error] .ygd-studio-notice-title{color:var(--ds-error)}
.ygd-studio-notice[data-tone=success] .ygd-studio-notice-title{color:var(--ds-success)}
.ygd-studio-notice-details{max-height:240px;overflow:auto;margin-top:8px;white-space:pre-wrap}
.ygd-studio-notice-details p{margin:0 0 6px}
.ygd-studio-notice-details ul{margin:0;padding-left:18px}
.ygd-studio-notice-details li+li{margin-top:6px}
.ygd-studio-save-feedback{display:flex;align-items:center;min-width:0;max-width:100%}
.ygd-studio-notice-inline .ygd-studio-notice-details{position:absolute;z-index:10;right:0;top:100%;width:min(420px,calc(100vw - 48px));padding:12px;border:1px solid var(--ds-border);border-radius:var(--ds-radius);background:var(--ds-surface);box-shadow:var(--ds-shadow,0 4px 18px #0002)}
.ygd-studio-instance{position:relative}
.ygd-studio-instance-feedback,.ygd-studio-notification-area{position:absolute;z-index:30;right:20px;bottom:20px;width:min(440px,calc(100% - 40px));max-height:calc(100% - 40px);overflow:auto;pointer-events:none}
.ygd-studio-instance-feedback:empty,.ygd-studio-notification-area:empty{display:none}
.ygd-studio-instance-feedback>.ygd-studio-notice,.ygd-studio-instance-feedback>.ygd-studio-notice-reopen,.ygd-studio-notification-area>.ygd-studio-notice,.ygd-studio-notification-area>.ygd-studio-notice-reopen{pointer-events:auto;background:var(--ds-surface);box-shadow:var(--ds-shadow,0 4px 18px #0002)}
.ygd-studio-instance-feedback>.ygd-studio-notice-reopen,.ygd-studio-notification-area>.ygd-studio-notice-reopen{padding:6px 12px;border:1px solid var(--ds-border);border-radius:var(--ds-radius)}
.ygd-studio-source-body{display:flex;flex-direction:column}
.ygd-studio-source-input{flex:1;min-height:360px;width:100%;resize:none;border:0;padding:16px;box-sizing:border-box;background:transparent;color:inherit;font:13px/1.7 var(--ds-mono-font,ui-monospace,SFMono-Regular,Consolas,monospace);tab-size:2}
.ygd-studio-component-browser{display:flex;flex:1;min-width:0;min-height:0;border-top:1px solid var(--ds-border)}
.ygd-studio-component-directory{width:240px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;padding:12px;border-right:1px solid var(--ds-border);min-height:0}
.ygd-studio-component-directory>.ygd-studio-search-input{width:100%;min-width:0}
.ygd-studio-component-catalog-tabs{display:flex;gap:4px;background:var(--ds-surface);border:1px solid var(--ds-border);border-radius:8px;padding:3px}
.ygd-studio-component-catalog-tabs button{flex:1;min-width:0;border:0;border-radius:5px;padding:6px 4px;font:inherit;font-size:12px;background:transparent;color:var(--ds-text-secondary);cursor:pointer}
.ygd-studio-component-catalog-tabs button[aria-selected=true]{background:var(--ds-primary-light);color:var(--ds-primary-dark)}
.ygd-studio-component-list{overflow:auto;min-height:0;flex:1}
.ygd-studio-component-directory-group summary{font-size:14px;font-weight:500;padding:8px;cursor:pointer}
.ygd-studio-component-directory-item{display:flex;flex-direction:column;align-items:flex-start;width:calc(100% - 24px);margin-left:24px;gap:3px;padding:8px;border:0;border-radius:8px;background:transparent;color:var(--ds-text);text-align:left;font:inherit;font-size:14px;overflow-wrap:anywhere;cursor:pointer}
.ygd-studio-component-directory-item:hover{background:var(--ds-bg-hover,#f5f4f9)}
.ygd-studio-component-directory-item[aria-current=page]{background:var(--ds-primary-light);color:var(--ds-primary)}
.ygd-studio-components code{font-family:var(--ds-mono-font,'Consolas',ui-monospace,monospace)}
.ygd-studio-component-list code{display:block;font-size:11px;color:var(--ds-text-secondary);margin-top:2px}
.ygd-studio-component-tree.dsh-panel-workspace-tree{padding:0;min-width:0}
.ygd-studio-component-tree .dsh-panel-workspace-tree-group{width:auto;padding:0;border:0}
.ygd-studio-component-tree .dsh-panel-workspace-tree-body{display:grid;gap:4px}
.ygd-studio-component-detail{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}
.ygd-studio-component-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px 12px}
.ygd-studio-component-heading>div{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px}
.ygd-studio-component-heading h2{font-size:18px;line-height:24px;font-weight:500}
.ygd-studio-component-heading code,.ygd-studio-component-support{font-size:12px;color:var(--ds-text-secondary);overflow-wrap:anywhere}
.ygd-studio-component-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 20px;border-bottom:1px solid var(--ds-border)}
.ygd-studio-component-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.ygd-studio-component-library-version{font-family:var(--ds-body-font);font-size:12px;font-variant-numeric:tabular-nums;line-height:20px;padding:2px 8px;border-radius:6px;background:var(--ds-primary-light);color:var(--ds-text-secondary)}
.ygd-studio-component-tabs{display:flex;gap:20px}
.ygd-studio-component-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;padding:10px 0;font:inherit;font-size:14px;color:var(--ds-text-secondary);cursor:pointer}
.ygd-studio-component-tabs button[aria-selected=true]{border-color:var(--ds-primary);color:var(--ds-primary)}
.ygd-studio-component-content{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}
.ygd-studio-component-preview{flex:1;min-width:0;min-height:0;overflow:auto;display:flex;flex-direction:column;padding:16px;background:var(--ds-background)}
.ygd-studio-component-stage{width:100%;min-width:0;border:1px solid var(--ds-border);border-radius:8px;background:var(--ds-surface)}
.ygd-studio-component-preview-inline .ygd-studio-component-stage{max-width:880px;margin:0 auto;padding:16px}
.ygd-studio-component-preview-navigation .ygd-studio-component-stage{max-width:360px;padding:12px;min-height:240px}
.ygd-studio-component-preview-inline .dsh-design-panel,.ygd-studio-component-preview-navigation .dsh-design-panel{height:auto;min-height:0}
.ygd-studio-component-preview-workspace{overflow:hidden}
.ygd-studio-component-preview-workspace .ygd-studio-component-stage{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.ygd-studio-component-preview-workspace .dsh-design-dock-panel-body{flex:1;min-height:0;overflow:hidden}
.ygd-studio-component-preview-workspace .dsh-design-panel{height:100%;min-height:0}
.ygd-studio-component-library-info{max-width:760px;padding:8px 20px 24px;overflow:auto;display:flex;flex-direction:column;gap:24px;font-size:14px;line-height:1.6}
.ygd-studio-component-library-info dl{margin:0;border-top:1px solid var(--ds-border)}
.ygd-studio-component-library-info dl>div{display:grid;grid-template-columns:112px minmax(0,1fr);gap:12px;padding:12px 0;border-bottom:1px solid var(--ds-border)}
.ygd-studio-component-library-info dt{color:var(--ds-text-secondary)}
.ygd-studio-component-library-info dd{margin:0;overflow-wrap:anywhere}
.ygd-studio-component-library-info code{font-size:12px}
.ygd-studio-component-library-note{color:var(--ds-text-secondary);font-size:12px}
.ygd-studio-component-doc{padding:16px 20px;display:flex;flex-direction:column;gap:16px;overflow:auto;min-width:0;line-height:1.6;font-size:14px}
.ygd-studio-component-doc pre{font-size:12px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--ds-bg-secondary,#f7f7f9);border:1px solid var(--ds-border);border-radius:8px;padding:12px;margin:0}
.ygd-studio-component-doc h3{font-size:14px;font-weight:500}
.ygd-studio-component-doc summary{cursor:pointer}
.ygd-studio-component-feedback{padding:8px 20px;color:var(--ds-text-secondary);font-size:12px}
.ygd-studio-component-feedback[role=alert]{color:var(--ds-danger,#bd3540)}
.ygd-studio-component-unavailable{margin:auto;padding:24px;max-width:480px;display:flex;flex-direction:column;align-items:flex-start;gap:16px;font-size:14px;line-height:1.6}
.ygd-studio-component-unavailable h3{font-size:16px;font-weight:500}
@media(max-width:760px){.ygd-studio-component-directory{width:180px}.ygd-studio-component-heading{align-items:flex-start;flex-direction:column;padding:12px}.ygd-studio-component-toolbar{padding:0 12px 8px;flex-wrap:wrap}.ygd-studio-component-preview{padding:12px}.ygd-studio-component-library-info dl>div{grid-template-columns:1fr;gap:4px}}
@media(max-width:480px){.ygd-studio-component-directory{width:140px;padding:8px}.ygd-studio-component-tabs{gap:12px}.ygd-studio-component-tabs button{font-size:12px}.ygd-studio-component-list button{font-size:12px}.ygd-studio-component-doc{padding:12px}}
.ygd-studio-back{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ds-text-secondary);cursor:pointer}
.ygd-studio-back:hover{background:var(--ds-primary-light);color:var(--ds-primary)}
.ygd-studio-back:focus-visible{outline:2px solid var(--ds-primary);outline-offset:2px}
.ygd-studio-header-title-group:has(>.ygd-studio-back){padding-left:0;flex-wrap:nowrap}
.ygd-studio-header-title-group:has(>.ygd-studio-back)>.ygd-studio-kitmark{position:static;flex-shrink:0}
.ygd-studio-loading{display:flex;align-items:center;justify-content:center;flex:1;min-height:96px;width:100%;align-self:stretch}
.ygd-studio-spinner{position:relative;display:inline-block;overflow:hidden;width:180px;height:2px;background:var(--ds-primary-light,#e5f0ed)}
.ygd-studio-spinner::before{content:'';position:absolute;inset:0 auto 0 0;width:34%;background:var(--ds-primary,#3f9e8b);animation:ygd-studio-progress 1.6s ease-in-out infinite}
@keyframes ygd-studio-progress{0%{transform:translateX(-110%);opacity:.45}50%{opacity:1}100%{transform:translateX(310%);opacity:.45}}
@media(prefers-reduced-motion:reduce){.ygd-studio-spinner::before{animation:none;width:100%;opacity:.8}}
.ygd-studio-trial{margin-top:8px;font-size:14px}
.ygd-studio-trial .ygd-studio-summary-card{display:grid;gap:8px;margin-top:8px;padding:12px;border:1px solid #e8e8e8;border-radius:8px;background:#fff;box-shadow:none}
.ygd-studio-trial button{min-height:32px;padding:5px 10px;border:1px solid #e8e8e8;border-radius:8px;background:#f7f7f7;color:#272727;font:inherit;cursor:pointer;width:fit-content}
.ygd-studio-trial button:disabled{opacity:.5;cursor:default}
.ygd-studio-trial textarea{display:block;margin-top:6px;padding:8px;border:1px solid #dfdfdf;border-radius:8px;font:inherit;background:#fff;color:#272727;resize:vertical}
.ygd-studio-trial small{color:#6d6d6d;overflow-wrap:anywhere}
.ygd-studio-trial button:focus-visible,.ygd-studio-trial textarea:focus-visible{outline:2px solid var(--ds-primary);outline-offset:2px}
.ygd-studio-workspace{
  --ds-primary:#7c5af6;--ds-primary-light:#f7f4fe;--ds-primary-dark:#6849d8;--ds-primary-active:#5032bc;
  --ds-secondary:#64748B;--ds-accent:#0EA5E9;
  --ds-background:#F7F7F7;--ds-surface:#FFFFFF;
  --ds-text:#272727;--ds-text-secondary:#6d6d6d;--ds-border:#E8E8E8;
  --ds-success:#059669;--ds-warning:#D97706;--ds-error:#DC2626;--ds-info:#0284C7;
  --ds-heading-font:'PingFang SC',-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;
  --ds-body-font:'PingFang SC',-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;
  --ds-mono-font:'JetBrains Mono','Fira Code','Consolas',monospace;
  --ds-base-font-size:14px;--ds-heading-weight:600;--ds-line-height:1.5;
  --ds-radius:8px;
  --ds-shadow:0 1px 3px rgba(0,0,0,.03);
  --ds-density-padding:12px;
  --ds-duration-fast:120ms;--ds-duration-normal:200ms;
  --ds-space-1:4px;--ds-space-2:8px;--ds-space-3:12px;--ds-space-4:16px;--ds-space-5:24px;--ds-space-6:32px;
  --ds-z-drawer:30;
  box-sizing:border-box;position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:24rem;
  background:var(--ds-background);color:var(--ds-text);
  font-family:var(--ds-body-font);font-size:var(--ds-base-font-size);line-height:var(--ds-line-height)}
.ygd-studio-workspace *{box-sizing:border-box}
.ygd-studio-workspace .ygd-studio-select{
  --ds-bg-white:var(--ds-surface);--ds-fill-5:var(--ds-border);--ds-border-default:var(--ds-border);
  --ds-text-primary:var(--ds-text);--ds-icon-outline-default:var(--ds-text-secondary);
  --ds-brand-light-bg-default:var(--ds-primary-light);--ds-brand-text-primary:var(--ds-primary-dark);
  --ds-radius-4:var(--ds-radius);--ygd-panel-control-focus:var(--ds-primary);
  display:inline-flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;max-width:100%;height:32px;
  padding:4px 10px;border:1px solid var(--ds-border);border-radius:var(--ds-radius);background:var(--ds-surface);color:var(--ds-text);font:inherit;line-height:20px;text-align:start;cursor:pointer}
.ygd-studio-select:focus-visible{outline:2px solid var(--ds-primary);outline-offset:2px}
.ygd-studio-select:disabled{cursor:not-allowed;opacity:.6}
button.ygd-studio-select>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.ygd-studio-select>span:last-child{display:flex;flex:none;align-items:center;color:var(--ds-text-secondary)}
.ygd-studio-workspace h1,.ygd-studio-workspace h2,.ygd-studio-workspace h3,.ygd-studio-workspace h4,.ygd-studio-workspace p,.ygd-studio-workspace ul,.ygd-studio-workspace ol{margin:0}

/* Narrow-viewport drawer toggle; positioned by the responsive block below */
.ygd-studio-menu-btn{display:none;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid var(--ds-border);
  background:var(--ds-surface);cursor:pointer;color:var(--ds-text-secondary);font-size:16px;border-radius:var(--ds-radius);
  box-shadow:var(--ds-shadow)}
.ygd-studio-menu-btn:hover{background:var(--ds-background);color:var(--ds-text)}

/* Shell */
.ygd-studio-body{display:flex;flex:1;min-height:0}
.ygd-studio-sidebar{width:176px;padding:20px 12px 12px;flex-shrink:0;background:var(--ds-background);border-right:1px solid var(--ds-border);
  display:flex;flex-direction:column;overflow-y:auto}
.ygd-studio-sidebar-logo{padding:0 6px 24px;font-family:var(--ds-heading-font);
  font-weight:var(--ds-heading-weight);font-size:18px;color:var(--ds-text);letter-spacing:-.6px;white-space:nowrap}
.ygd-studio-sidebar-nav{padding:var(--ds-space-2) 0}
.ygd-studio-sidebar-item{display:block;width:100%;padding:8px 10px;margin:2px 0;min-height:36px;border-radius:8px;font-size:14px;
  color:var(--ds-text-secondary);cursor:pointer;border:none;background:none;text-align:left;font-family:var(--ds-body-font);
  transition:color var(--ds-duration-fast),background var(--ds-duration-fast)}
.ygd-studio-sidebar-item:hover{color:var(--ds-text);background:var(--ds-background)}
.ygd-studio-sidebar-item[aria-current="page"]{color:var(--ds-primary-dark);background:var(--ds-primary-light);font-weight:500}
.ygd-studio-stage{position:relative;display:flex;flex:1;flex-direction:column;min-width:0;min-height:0}
.ygd-studio-topbar{height:46px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--ds-border);background:#fff;font-size:12px;color:var(--ds-text-secondary)}
.ygd-studio-topbar span span{padding:0 10px;color:#b2b2b2}
.ygd-studio-topbar-actions{display:flex;align-items:center;gap:12px}
.ygd-studio-language{display:flex;align-items:center;padding:2px;border:1px solid var(--ds-border);border-radius:var(--ds-radius);background:var(--ds-background)}
.ygd-studio-sidebar-footer{margin-top:auto;padding:16px 0 0;display:flex;flex-direction:column;align-items:flex-start;gap:12px}
.ygd-studio-sidebar-utilities{width:100%}
.ygd-studio-sidebar-footer>.ygd-studio-language{margin-left:4px}
.ygd-studio-language button{height:30px;min-width:38px;padding:0 8px;border:0;border-radius:4px;background:transparent;color:var(--ds-text-secondary);font:400 14px/20px var(--ds-body-font);cursor:pointer}
.ygd-studio-language button[aria-pressed="true"]{background:var(--ds-primary-light);color:var(--ds-primary-dark);font-weight:500}
.ygd-studio-language button:focus-visible{outline:2px solid var(--ds-primary);outline-offset:1px}
.ygd-studio-main{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden}

/* Content header */
.ygd-studio-content-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;
  min-height:48px;padding:8px 20px;background:transparent;border-bottom:0;flex-shrink:0}
.ygd-studio-header-title-group{display:flex;align-items:center;gap:var(--ds-space-2);flex-wrap:nowrap;min-height:32px;min-width:0}
.ygd-studio-header-title-group>.ygd-studio-kitmark{position:static;width:32px;height:32px;border-radius:8px}
.ygd-studio-header-title-group>.ygd-studio-kitmark svg{width:20px;height:20px}
.ygd-studio-header-title-group>.ygd-studio-search-input{height:32px;min-height:32px;min-width:0}
.ygd-studio-catalog-header{gap:12px 16px;padding:16px 20px 24px}
.ygd-studio-catalog-tools{display:flex;align-items:center;gap:16px;min-width:0;max-width:100%;font-size:13px;color:var(--ds-text-secondary)}
.ygd-studio-catalog-tools>[role=status]{white-space:nowrap;font-variant-numeric:tabular-nums}
.ygd-studio-catalog-tools>.ygd-studio-search-input{width:300px;min-width:0;max-width:100%;height:32px;min-height:32px}
@media(max-width:600px){.ygd-studio-catalog-tools{flex:1 1 100%;flex-wrap:wrap;gap:8px 12px}.ygd-studio-catalog-tools>.ygd-studio-search-input{flex:1 1 180px;width:auto}.ygd-studio-catalog-header>.ygd-studio-catalog-link{margin-left:0}}
.ygd-studio-page-title{font-family:var(--ds-heading-font);font-weight:500;font-size:18px;line-height:24px;color:var(--ds-text);letter-spacing:-.5px;min-width:0;overflow-wrap:anywhere}
.ygd-studio-subtitle{font-size:12px;color:var(--ds-text-secondary);margin:0}
.ygd-studio-workspace .ygd-studio-feedback,.ygd-studio-workspace .ygd-studio-error{font:13px/1.6 var(--ds-body-font);margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ds-text-secondary)}
.ygd-studio-workspace .ygd-studio-error{color:var(--ds-error)}
.ygd-studio-context-label{display:none}
.ygd-studio-version-badge{font-size:11px;padding:2px 8px;border-radius:var(--ds-radius);background:var(--ds-background);
  border:1px solid var(--ds-border);color:var(--ds-text-secondary);white-space:nowrap}
.ygd-studio-readonly-badge{font-size:11px;padding:2px 8px;border-radius:var(--ds-radius);background:var(--ds-background);
  border:1px solid var(--ds-border);color:var(--ds-text-secondary);white-space:nowrap;font-weight:500}
.ygd-studio-mounted-ref{font-size:11px;color:var(--ds-text-secondary);display:flex;align-items:center;gap:var(--ds-space-1)}
.ygd-studio-mounted-ref strong{color:var(--ds-text);font-weight:500}
.ygd-studio-breadcrumb{display:flex;align-items:center;gap:var(--ds-space-2);font-size:12px;color:var(--ds-text-secondary)}
.ygd-studio-breadcrumb-sep{color:var(--ds-border)}
.ygd-studio-breadcrumb-current{color:var(--ds-text);font-weight:500}
.ygd-studio-breadcrumb-button{border:none;background:none;padding:0;font:inherit;color:inherit;cursor:pointer}
.ygd-studio-breadcrumb-button:hover{color:var(--ds-primary)}

/* Workplane tabs */
.ygd-studio-workplane-bar{display:flex;gap:23px;border-bottom:1px solid var(--ds-border);background:transparent;
  margin:0 20px;padding:0;flex-shrink:0;flex-wrap:wrap}
.ygd-studio-workplane-tab{padding:0 2px 9px;font-size:13px;font-weight:500;
  color:var(--ds-text-secondary);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;
  font-family:var(--ds-body-font);transition:color var(--ds-duration-fast),border-color var(--ds-duration-fast)}
.ygd-studio-workplane-tab:hover{color:var(--ds-text)}
.ygd-studio-workplane-tab[aria-selected="true"],.ygd-studio-workplane-tab[aria-pressed="true"]{color:var(--ds-primary);border-bottom-color:var(--ds-primary)}

/* Content body */
.ygd-studio-content-body{flex:1;min-height:0;overflow-y:auto;padding:0 20px 18px;display:flex;flex-direction:column}
/* File workspaces own their shared outer margins; do not add a second Kit inset. */
.ygd-studio-kit-files-body{padding:0;overflow:hidden}

/* Bundle search */
.ygd-studio-search{margin-bottom:var(--ds-space-4);max-width:400px}
.ygd-studio-section-title{font:500 15px/22px var(--ds-body-font);margin:0}
.ygd-studio-field{display:grid;gap:6px}
.ygd-studio-search-input,.ygd-studio-text-input{width:100%;height:34px;min-height:34px;margin:0;padding:0 10px;font-size:13px;
  font-family:var(--ds-body-font);color:var(--ds-text);background:var(--ds-surface);
  border:1px solid var(--ds-border);border-radius:var(--ds-radius);outline:none;
  transition:border-color var(--ds-duration-fast)}
.ygd-studio-text-input.ygd-studio-textarea{height:auto;min-height:88px;padding:8px 10px;resize:vertical}
.ygd-studio-search-input:focus,.ygd-studio-text-input:focus{border-color:var(--ds-primary)}
.ygd-studio-search-input::placeholder,.ygd-studio-text-input::placeholder{color:var(--ds-text-secondary)}

/* Shared Kit / Bundle catalog cards */
.ygd-studio-kits-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.ygd-studio-kit-card{background:var(--ds-surface);border:1px solid var(--ds-border);border-radius:var(--ds-radius);
  padding:15px;display:flex;flex-direction:column;gap:0;min-width:0;text-align:left;font:inherit;color:inherit;
  cursor:pointer;transition:box-shadow var(--ds-duration-fast)}
.ygd-studio-kit-card:hover{box-shadow:var(--ds-shadow)}
.ygd-studio-kit-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--ds-space-2)}
.ygd-studio-kit-card-name{font-family:var(--ds-heading-font);font-weight:var(--ds-heading-weight);font-size:15px;color:var(--ds-text)}
.ygd-studio-kit-card-meta{display:flex;flex-direction:column;gap:var(--ds-space-1)}
.ygd-studio-kit-card-meta-row{font-size:12px;color:var(--ds-text-secondary);display:flex;align-items:center;gap:var(--ds-space-2)}
.ygd-studio-meta-label{color:var(--ds-text-secondary);min-width:80px}
.ygd-studio-meta-value{color:var(--ds-text)}
.ygd-studio-kit-card-actions{margin-top:var(--ds-space-1);padding-top:var(--ds-space-3);border-top:1px solid var(--ds-border)}
.ygd-studio-btn-primary{display:inline-flex;align-items:center;gap:var(--ds-space-2);padding:var(--ds-space-2) var(--ds-space-3);
  font-size:12px;font-weight:500;font-family:var(--ds-body-font);color:#fff;background:var(--ds-primary);border:none;
  border-radius:var(--ds-radius);cursor:pointer;transition:background var(--ds-duration-fast)}
.ygd-studio-btn-primary:hover{background:var(--ds-primary-dark)}
.ygd-studio-btn-primary:active{background:var(--ds-primary-active)}
.ygd-studio-trial button.ygd-studio-btn-primary{background:var(--ds-primary);color:#fff;border-color:transparent}
.ygd-studio-trial button.ygd-studio-btn-primary:hover{background:var(--ds-primary-dark)}
.ygd-studio-trial button.ygd-studio-btn-primary:active{background:var(--ds-primary-active)}
.ygd-studio-btn-link{font-size:12px;color:var(--ds-primary);cursor:pointer;border:none;background:none;
  font-family:var(--ds-body-font);padding:var(--ds-space-1) var(--ds-space-2);border-radius:var(--ds-radius);
  transition:background var(--ds-duration-fast)}
.ygd-studio-btn-link:hover{background:var(--ds-background)}

/* Empty state */
.ygd-studio-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:var(--ds-space-6);text-align:center;color:var(--ds-text-secondary);font-size:14px}

.ygd-studio-mounts-editor{display:flex;flex:1;min-height:0;min-width:0;flex-direction:column;padding:2px 20px 16px;gap:12px;container-type:inline-size;container-name:studio-mounts}
.ygd-studio-mounts-columns{display:grid;grid-template-columns:minmax(240px,300px) minmax(0,1fr);gap:24px;flex:1;min-height:0;min-width:0}
.ygd-studio-mounts-column{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0}
.ygd-studio-mounts-heading{display:flex;align-items:center;gap:8px;min-height:32px}
.ygd-studio-mounts-heading h2{font-size:14px;font-weight:500;flex-shrink:0}
.ygd-studio-mounts-heading>span{flex-shrink:0;font-size:12px;color:var(--ds-text-secondary);font-variant-numeric:tabular-nums}
.ygd-studio-mounts-search{flex:1;min-width:0;width:auto;height:32px;min-height:32px;margin-left:auto}
.ygd-studio-mounts-selected{border-left:1px solid var(--ds-border);padding-left:20px}
.ygd-studio-mounts-card-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));align-content:start;gap:12px;min-height:0;overflow:auto;padding:1px 4px 4px 1px}
.ygd-studio-mounts-candidates .ygd-studio-mounts-card-list{grid-template-columns:minmax(0,1fr)}
.ygd-studio-mounts-card-list .ygd-studio-kit-card{cursor:default}
.ygd-studio-mounts-change-status{margin-right:auto;color:var(--ds-text-secondary);font-size:12px}
@container studio-mounts (max-width:640px){.ygd-studio-mounts-columns{grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(2,minmax(0,1fr));gap:16px}.ygd-studio-mounts-selected{border-left:0;border-top:1px solid var(--ds-border);padding-left:0;padding-top:16px}}

/* Bundle items */
.ygd-studio-bundles-list{display:flex;flex-direction:column;gap:var(--ds-space-3)}
.ygd-studio-bundle-item{display:flex;align-items:center;justify-content:space-between;gap:var(--ds-space-3);
  background:var(--ds-surface);border:1px solid var(--ds-border);border-radius:var(--ds-radius);
  padding:var(--ds-space-3) var(--ds-space-4);transition:box-shadow var(--ds-duration-fast)}
.ygd-studio-bundle-item:hover{box-shadow:var(--ds-shadow)}
.ygd-studio-bundle-info{display:flex;flex-direction:column;gap:var(--ds-space-1);min-width:0;flex:1}
.ygd-studio-bundle-name-row{display:flex;align-items:center;gap:var(--ds-space-2);flex-wrap:wrap}
.ygd-studio-bundle-name{font-weight:500;font-size:14px;color:var(--ds-text)}
.ygd-studio-bundle-id{font-family:var(--ds-mono-font);font-size:11px;color:var(--ds-text-secondary)}
.ygd-studio-bundle-purpose{font-size:12px;color:var(--ds-text-secondary)}
.ygd-studio-bundle-item-card{align-items:flex-start}
.ygd-studio-card-description{font-size:12px;line-height:1.6;color:var(--ds-text-secondary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.ygd-studio-card-description .ygd-studio-markdown{max-width:none;font-size:12px;line-height:1.6;color:var(--ds-text-secondary)}
.ygd-studio-card-description .ygd-studio-markdown p,
.ygd-studio-card-description .ygd-studio-markdown ul,
.ygd-studio-card-description .ygd-studio-markdown ol{margin-bottom:var(--ds-space-1)}
.ygd-studio-card-description .ygd-studio-markdown ul,
.ygd-studio-card-description .ygd-studio-markdown ol{padding-left:var(--ds-space-4)}
.ygd-studio-card-description .ygd-studio-markdown li{margin-bottom:2px}
.ygd-studio-card-description .ygd-studio-markdown strong{color:var(--ds-text);font-weight:600}
.ygd-studio-bundle-actions{flex-shrink:0}

/* Document toolbar (rich/source toggle) */
.ygd-studio-doc-toolbar{display:flex;align-items:center;gap:var(--ds-space-2);margin-bottom:var(--ds-space-3);flex-shrink:0}
.ygd-studio-doc-toggle-group{display:inline-flex;border:1px solid var(--ds-border);border-radius:var(--ds-radius);
  overflow:hidden;background:var(--ds-surface)}
.ygd-studio-doc-toggle{padding:var(--ds-space-1) var(--ds-space-3);font-size:12px;line-height:18px;border:none;
  background:var(--ds-surface);color:var(--ds-text-secondary);cursor:pointer;font-family:var(--ds-body-font);
  transition:color var(--ds-duration-fast),background var(--ds-duration-fast)}
.ygd-studio-doc-toggle+.ygd-studio-doc-toggle{border-left:1px solid var(--ds-border)}
.ygd-studio-doc-toggle:hover{color:var(--ds-text);background:var(--ds-background)}
.ygd-studio-doc-toggle[aria-pressed="true"]{background:var(--ds-primary);color:#fff}
.ygd-studio-doc-meta{margin-left:auto;font-size:11px;color:var(--ds-text-secondary);font-family:var(--ds-mono-font)}

/* Frontmatter + rich markdown */
.ygd-studio-frontmatter{background:var(--ds-background);border:1px solid var(--ds-border);border-radius:var(--ds-radius);
  padding:var(--ds-space-3) var(--ds-space-4);margin-bottom:var(--ds-space-4);font-family:var(--ds-mono-font);
  font-size:12px;line-height:1.6;color:var(--ds-text-secondary);white-space:pre-wrap;word-break:break-word}
.ygd-studio-markdown{max-width:800px;font-size:var(--ds-base-font-size);line-height:1.7;color:var(--ds-text)}
.ygd-studio-markdown h1{font-family:var(--ds-heading-font);font-weight:var(--ds-heading-weight);font-size:20px;margin-bottom:var(--ds-space-3)}
.ygd-studio-markdown h2{font-family:var(--ds-heading-font);font-weight:var(--ds-heading-weight);font-size:16px;margin-top:var(--ds-space-5);margin-bottom:var(--ds-space-2)}
.ygd-studio-markdown h3,.ygd-studio-markdown h4{font-family:var(--ds-heading-font);font-weight:var(--ds-heading-weight);font-size:14px;margin-top:var(--ds-space-4);margin-bottom:var(--ds-space-2)}
.ygd-studio-markdown p{margin-bottom:var(--ds-space-3)}
.ygd-studio-markdown ul,.ygd-studio-markdown ol{margin-bottom:var(--ds-space-3);padding-left:var(--ds-space-5)}
.ygd-studio-markdown li{margin-bottom:var(--ds-space-1)}
.ygd-studio-markdown code{font-family:var(--ds-mono-font);font-size:12px;background:var(--ds-background);padding:1px 4px;border-radius:3px;color:var(--ds-text)}
.ygd-studio-markdown pre{background:var(--ds-background);border:1px solid var(--ds-border);border-radius:var(--ds-radius);
  padding:var(--ds-space-3);margin-bottom:var(--ds-space-4);font-family:var(--ds-mono-font);font-size:12px;line-height:1.6;overflow-x:auto}
.ygd-studio-markdown pre code{background:none;padding:0}
.ygd-studio-markdown-table-scroll{max-width:100%;overflow-x:auto;margin-bottom:var(--ds-space-4);border:1px solid var(--ds-border);border-radius:var(--ds-radius)}
.ygd-studio-markdown-table-scroll:focus-visible{outline:2px solid var(--ds-primary);outline-offset:2px}
.ygd-studio-markdown table{width:100%;border-collapse:collapse;font-size:inherit;line-height:1.6}
.ygd-studio-markdown th,.ygd-studio-markdown td{padding:8px 12px;text-align:left;vertical-align:top;overflow-wrap:anywhere;border-bottom:1px solid var(--ds-border)}
.ygd-studio-markdown th{background:var(--ds-background);font-weight:600}
.ygd-studio-markdown th+th,.ygd-studio-markdown td+td{border-left:1px solid var(--ds-border)}
.ygd-studio-markdown tbody tr:last-child td{border-bottom:0}
.ygd-studio-markdown tbody tr:nth-child(even){background:var(--ds-background)}

/* Code viewer with line numbers; fills the remaining height of its flex parent */
.ygd-studio-code-frame{flex:1 1 auto;min-height:min(64vh,52rem);display:flex;flex-direction:column;
  background:var(--ds-surface);border:1px solid var(--ds-border);border-radius:var(--ds-radius);overflow:hidden}
.ygd-studio-code-scroll{flex:1;min-height:0;overflow:auto;padding:var(--ds-space-4) 0}
.ygd-studio-code-view{display:flex;font-family:var(--ds-mono-font);font-size:13px;line-height:1.6;color:var(--ds-text)}
.ygd-studio-line-numbers{width:44px;flex-shrink:0;text-align:right;padding:0 var(--ds-space-3);color:var(--ds-text-secondary);
  font-size:12px;line-height:1.6;user-select:none;border-right:1px solid var(--ds-border);margin-right:var(--ds-space-3);white-space:pre}
.ygd-studio-code-body{margin:0;padding:0 var(--ds-space-4) 0 0;white-space:pre-wrap;word-break:break-word;flex:1;min-width:0;
  font-family:var(--ds-mono-font);font-size:13px;line-height:1.6}

/* Summaries */
.ygd-studio-summary-panel{margin-top:var(--ds-space-5);border-top:1px solid var(--ds-border);padding-top:var(--ds-space-4)}
.ygd-studio-summary-title{font-family:var(--ds-heading-font);font-weight:var(--ds-heading-weight);font-size:14px;color:var(--ds-text);margin-bottom:var(--ds-space-3)}
.ygd-studio-summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--ds-space-4)}
.ygd-studio-summary-card{background:var(--ds-background);border:1px solid var(--ds-border);border-radius:var(--ds-radius);padding:var(--ds-space-3)}
.ygd-studio-summary-card-title{font-size:12px;font-weight:600;color:var(--ds-text-secondary);margin-bottom:var(--ds-space-2);text-transform:uppercase;letter-spacing:.03em}
.ygd-studio-summary-field{display:flex;justify-content:space-between;gap:var(--ds-space-2);padding:var(--ds-space-1) 0;font-size:12px;border-bottom:1px solid var(--ds-border)}
.ygd-studio-summary-field:last-child{border-bottom:none}
.ygd-studio-summary-field-name{color:var(--ds-text)}
.ygd-studio-summary-field-type{font-family:var(--ds-mono-font);color:var(--ds-text-secondary);font-size:11px}

/* Native Panel readonly placeholder */
.ygd-studio-panel-container{margin-top:var(--ds-space-5);border:1px solid var(--ds-border);border-radius:var(--ds-radius);overflow:hidden}
.ygd-studio-panel-header{padding:var(--ds-space-2) var(--ds-space-3);background:var(--ds-background);
  border-bottom:1px solid var(--ds-border);font-size:12px;font-weight:600;color:var(--ds-text-secondary);
  display:flex;align-items:center;gap:var(--ds-space-2);flex-wrap:wrap}
.ygd-studio-panel-badge{font-size:10px;padding:1px 6px;border-radius:var(--ds-radius);background:var(--ds-border);color:var(--ds-text-secondary)}
.ygd-studio-panel-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:var(--ds-space-5);text-align:center;color:var(--ds-text-secondary);gap:var(--ds-space-2)}
.ygd-studio-panel-placeholder-text{font-size:13px}
.ygd-studio-panel-placeholder-sub{font-size:11px;opacity:.7}

/* Bundle workspace two-pane body */
.ygd-studio-workspace-body{flex:1;display:flex;min-height:0;overflow:hidden;background:var(--ds-surface)}
.ygd-studio-workspace [hidden]{display:none!important}
.ygd-studio-file-tree-pane{width:240px;flex-shrink:0;background:var(--ds-surface);border-right:1px solid var(--ds-border);
  display:flex;flex-direction:column;overflow:hidden}
.ygd-studio-file-tree-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:var(--ds-space-2) var(--ds-space-3);font-size:11px;font-weight:600;
  color:var(--ds-text-secondary);border-bottom:1px solid var(--ds-border)}
.ygd-studio-new-file{display:flex;flex-direction:column;gap:8px;padding:12px;border-bottom:1px solid var(--ds-border)}
.ygd-studio-new-file .ygd-studio-text-input{width:100%;box-sizing:border-box}
.ygd-studio-file-tree{flex:1;overflow-y:auto;padding:var(--ds-space-2) 0}
.ygd-studio-tree-section{padding:var(--ds-space-2) var(--ds-space-3) var(--ds-space-1);font-size:11px;font-weight:600;
  color:var(--ds-text-secondary);text-transform:uppercase;letter-spacing:.03em}
.ygd-studio-tree-node{display:flex;align-items:center;gap:var(--ds-space-2);width:100%;padding:var(--ds-space-1) var(--ds-space-3);
  font-size:13px;color:var(--ds-text);cursor:pointer;border:none;background:none;text-align:left;font-family:var(--ds-body-font);
  transition:background var(--ds-duration-fast)}
.ygd-studio-tree-node:hover{background:var(--ds-background)}
.ygd-studio-tree-node[aria-current="true"]{background:var(--ds-primary-light);color:var(--ds-primary-dark)}
.ygd-studio-tree-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ygd-studio-content-pane{flex:1;display:flex;flex-direction:column;min-width:0;overflow-y:auto;padding:var(--ds-space-4) var(--ds-space-5)}

/* Diagnostics */
.ygd-studio-diagnostics{margin:var(--ds-space-3) var(--ds-space-5) 0;padding:10px 14px;border-radius:var(--ds-radius);
  border:1px solid #FECACA;background:#FEF2F2;color:var(--ds-error);list-style:none;font-size:13px}

/* Explicit sample-only authoring. Runtime Panel descendants keep their own styles. */
/* Approved compact Studio composition; neutral controls measured on yugoo.cn. */
.ygd-studio-content-header:has(.ygd-studio-breadcrumb){display:block}
.ygd-studio-content-header .ygd-studio-breadcrumb{margin-bottom:10px}
.ygd-studio-content-header>div:has(>.ygd-studio-header-title-group){display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;width:100%;min-width:0}
.ygd-studio-content-header>div:has(>.ygd-studio-hero-actions)>.ygd-studio-header-title-group{flex:1 1 200px}
.ygd-studio-hero-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;max-width:100%;margin-left:auto}
.ygd-studio-editor-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ygd-studio-preview-caption{margin:0;padding:10px 16px;font-size:12px;color:var(--ds-text-secondary)}
.ygd-studio-hero-actions .ygd-studio-trial{position:relative}
.ygd-studio-hero-actions .ygd-studio-trial:has([aria-expanded="true"]){width:auto}
.ygd-studio-hero-actions .ygd-studio-trial>.ygd-studio-summary-card{position:absolute;right:0;top:100%;z-index:20;width:min(480px,75vw);max-height:65vh;overflow:auto;box-shadow:0 8px 30px #0002}
.ygd-studio-content-header .ygd-studio-btn-primary,.ygd-studio-content-header .ygd-studio-btn-link{margin-top:8px;margin-right:6px}
.ygd-studio-file-tree-pane{width:230px;background:#f8f9fb}
.ygd-studio-file-tree{padding:8px 0}
.ygd-studio-tree-node,.ygd-studio-tree-folder>summary{height:28px;min-height:28px;display:flex;align-items:center;gap:6px;padding:0 10px;font:400 13px/28px var(--ds-body-font);color:#404957;white-space:nowrap;cursor:pointer}
.ygd-studio-tree-folder>summary{list-style:none}
.ygd-studio-tree-folder>summary::-webkit-details-marker{display:none}
.ygd-studio-tree-folder>summary:hover,.ygd-studio-tree-node:hover{background:#eef0f4}
.ygd-studio-tree-children{margin-left:14px;padding-left:8px;border-left:1px solid #e3e6ec}
.ygd-studio-chevron{width:10px;flex:0 0 10px;color:#8793a6;font-size:16px}
.ygd-studio-tree-folder[open]>summary .ygd-studio-chevron{transform:rotate(90deg)}
.ygd-studio-file-icon{width:16px;height:16px;flex:0 0 16px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round;color:#8793a6}
.ygd-studio-file-icon.markdown{color:#698aaf}.ygd-studio-file-icon.config{color:#a98e4e}
.ygd-studio-tree-node[aria-current="true"]{background:var(--ds-primary-light);box-shadow:inset 2px 0 var(--ds-primary);color:var(--ds-primary-dark)}
.ygd-studio-file-path{font:12px var(--ds-body-font);color:var(--ds-text-secondary);padding-bottom:12px;overflow-wrap:anywhere}
.ygd-studio-content-pane{padding:14px 20px;background:#fff}
.ygd-studio-mindset-layout{display:grid;grid-template-columns:minmax(0,1fr) 205px;gap:14px;min-height:0;flex:1}
.ygd-studio-document-card{display:flex;flex-direction:column;min-height:0;min-width:0;border:1px solid var(--ds-border);border-radius:10px;background:#fff;overflow:hidden}
.ygd-studio-document-card>.ygd-studio-doc-toolbar{padding:9px 14px;border-bottom:1px solid var(--ds-border);margin:0}

/* Authoring composition: conversation stays mounted while the adjacent content changes. */
.ygd-studio-authoring-layout{display:grid;grid-template-columns:minmax(280px,360px) minmax(0,1fr);min-height:0;border-top:1px solid var(--ds-border)}
.ygd-studio-conversation{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--ds-surface);border-right:1px solid var(--ds-border)}
.ygd-studio-conversation-header{padding:16px;border-bottom:1px solid var(--ds-border)}
.ygd-studio-conversation-header h2{font:500 15px/24px var(--ds-heading-font)}
.ygd-studio-conversation-header p,.ygd-studio-conversation-note{color:var(--ds-text-secondary);font-size:12px;line-height:1.6}
.ygd-studio-conversation-log{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:20px 16px;scrollbar-gutter:stable}
.ygd-studio-conversation-welcome{display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.7}
.ygd-studio-conversation-welcome strong{font-weight:500}
.ygd-studio-conversation-welcome p{color:var(--ds-text-secondary)}
.ygd-studio-conversation-turn{margin-bottom:24px}
.ygd-studio-conversation-message{display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.7;overflow-wrap:anywhere}
.ygd-studio-conversation-message>p{white-space:pre-wrap}
.ygd-studio-conversation-actions{display:flex;flex-wrap:wrap;gap:8px}
.ygd-studio-conversation-composer{display:flex;flex-direction:column;gap:8px;flex:none;max-height:60%;overflow:auto;padding:12px 16px;border-top:1px solid var(--ds-border)}
.ygd-studio-conversation-composer .ygd-studio-field{gap:8px;font-size:12px}
.ygd-studio-conversation-composer textarea{min-height:88px;max-height:200px;resize:vertical;font:13px/1.7 var(--ds-body-font)}
.ygd-studio-conversation-send{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.ygd-studio-authoring-content{container:studio-authoring-content / inline-size;display:flex;min-width:0;min-height:0;overflow:hidden}
@media(max-width:1100px){.ygd-studio-authoring-layout{grid-template-columns:300px minmax(0,1fr)}.ygd-studio-authoring-content .ygd-studio-file-tree-pane{width:150px}}
@container studio-authoring-content (max-width:800px){.ygd-studio-authoring-content .ygd-studio-files-layout{display:grid;grid-template-columns:150px minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto}.ygd-studio-authoring-content .ygd-studio-file-tree-pane{grid-row:1 / 3;width:150px}.ygd-studio-authoring-content .ygd-studio-files-layout>.ygd-studio-content-pane{grid-column:2;grid-row:1;min-height:0}.ygd-studio-authoring-content .ygd-studio-file-info{grid-column:2;grid-row:2;border-left:0;border-top:1px solid var(--ds-border);max-height:140px}}
@media(max-width:700px){.ygd-studio-authoring-layout{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(240px,45%) minmax(0,1fr)}.ygd-studio-conversation{border-right:0;border-bottom:1px solid var(--ds-border)}.ygd-studio-conversation-header{padding:8px 12px}.ygd-studio-conversation-header p{display:none}.ygd-studio-conversation-log{padding:12px}.ygd-studio-conversation-composer{padding:8px 12px;max-height:70%}.ygd-studio-conversation-composer textarea{min-height:60px}}
.ygd-studio-document-name{font:500 13px var(--ds-mono-font);margin-right:auto}
.ygd-studio-file-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;flex:1;min-width:180px}
.ygd-studio-file-heading>.ygd-studio-document-name{margin-right:0;overflow-wrap:anywhere}
.ygd-studio-file-info{flex:0 0 224px;box-sizing:border-box;min-height:0;overflow:auto;border-left:1px solid var(--ds-border);padding:16px;background:var(--ds-surface,#fafafa)}
.ygd-studio-file-info h3{margin:0 0 8px;font:500 13px/1.5 var(--ds-body-font)}
.ygd-studio-file-info .ygd-studio-markdown{font:400 12px/1.7 var(--ds-body-font);color:var(--ds-text-secondary);max-width:none}
.ygd-studio-file-info .ygd-studio-markdown p{margin:0 0 8px}
.ygd-studio-file-info .ygd-studio-markdown ul{padding-left:16px;margin:0}
.ygd-studio-card-meta{font-size:11px;line-height:1.6;color:var(--ds-text-secondary);margin:0 0 12px}
@media(max-width:1100px){.ygd-studio-file-info{flex-basis:180px;padding:12px}}
@media(max-width:800px){
  .ygd-studio-files-layout{display:grid;grid-template-columns:150px minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto}
  .ygd-studio-files-layout>.ygd-studio-file-tree-pane{grid-row:1 / 3;width:150px}
  .ygd-studio-files-layout>.ygd-studio-content-pane{grid-column:2;grid-row:1;min-height:0}
  .ygd-studio-files-layout>.ygd-studio-file-info{grid-column:2;grid-row:2;border-left:0;border-top:1px solid var(--ds-border);max-height:140px}
}
.ygd-studio-doc-meta{margin-left:0}
.ygd-studio-kitmark{width:43px;height:43px;border-radius:11px;background:#ededed;color:#575757;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.ygd-studio-kitmark svg{width:24px;height:24px}
.ygd-studio-btn-secondary{border:1px solid var(--ds-border);border-radius:8px;padding:6px 11px;background:white;font:500 13px var(--ds-body-font);color:var(--ds-text);cursor:pointer;white-space:nowrap}
.ygd-studio-btn-secondary:disabled{color:#aaa;cursor:not-allowed;background:#fafafa}
.ygd-studio-instance-actions{display:flex;gap:6px}
.ygd-studio-modal{width:min(640px,90vw);max-height:82vh;overflow:auto;margin:auto;padding:22px;border:1px solid var(--ds-border);border-radius:12px;background:var(--ds-surface);color:var(--ds-text);font:14px/1.6 var(--ds-body-font)}
.ygd-studio-modal::backdrop{background:#0005}
.ygd-studio-modal>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px}
.ygd-studio-modal h2{font-size:18px}.ygd-studio-modal>header button{border:0;background:none;font:24px var(--ds-body-font);cursor:pointer;color:#6d6d6d}
.ygd-studio-modal>p{margin:10px 0;color:var(--ds-text-secondary);font-size:13px}
.ygd-studio-transfer{display:grid;gap:14px;min-width:0}
.ygd-studio-transfer p{margin:0;overflow-wrap:anywhere}
.ygd-studio-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.ygd-studio-error-entry{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0;padding:10px 12px;border:1px solid color-mix(in srgb,var(--ds-error) 25%,var(--ds-border));border-radius:var(--ds-radius);background:var(--ds-surface);color:var(--ds-text);font:13px/1.6 var(--ds-body-font);min-width:0;pointer-events:auto}
.ygd-studio-feedback-icon{width:18px;height:18px;flex:none;color:var(--ds-error)}
.ygd-studio-error-title{flex:1;min-width:120px;overflow-wrap:anywhere}
.ygd-studio-content-state{display:flex;flex:1;align-items:center;justify-content:center;min-width:0;min-height:180px;width:100%;padding:24px;box-sizing:border-box;font:13px/1.6 var(--ds-body-font);color:var(--ds-text-secondary);text-align:center}
.ygd-studio-content-state-card{display:flex;flex-direction:column;align-items:center;gap:6px;width:min(100%,320px);overflow-wrap:anywhere}
.ygd-studio-content-state-heading{display:flex;align-items:center;justify-content:center;gap:7px}
.ygd-studio-content-state-icon{width:18px;height:18px;flex:none;color:var(--ds-warning)}
.ygd-studio-content-state-heading>strong{color:var(--ds-text-secondary);font-weight:500;font-size:13px}
.ygd-studio-content-state-card>p{margin:0;max-width:100%;font-size:12px}
.ygd-studio-content-state[data-tone=info] .ygd-studio-content-state-icon{color:var(--ds-text-secondary)}
.ygd-studio-content-state-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin-top:4px}
.ygd-studio-field-error{display:block;margin:4px 0;font:12px/1.6 var(--ds-body-font);color:var(--ds-error);overflow-wrap:anywhere}
.ygd-studio-error-dialog{box-sizing:border-box;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow-wrap:anywhere;pointer-events:auto}
.ygd-studio-error-dialog>p{white-space:pre-wrap}
.ygd-studio-error-details{font:13px/1.6 var(--ds-body-font);margin:16px 0;color:var(--ds-text-secondary)}
.ygd-studio-error-details summary{cursor:pointer;color:var(--ds-text);font-weight:500}
.ygd-studio-error-details ul{padding-left:20px;max-height:40vh;overflow:auto;white-space:pre-wrap}
.ygd-studio-error-details li+li{margin-top:10px}
.ygd-studio-error-details li>.ygd-studio-btn-link{margin-right:8px}
.ygd-studio-error-dialog .ygd-studio-modal-actions{flex-wrap:wrap}
.ygd-studio-modal .ygd-studio-code-frame{min-height:0;max-height:60vh}.ygd-studio-modal .ygd-studio-code-scroll{max-height:60vh}
.ygd-studio-topbar{gap:12px}.ygd-studio-topbar>span{display:flex;align-items:center;gap:8px}
.ygd-studio-content-header .ygd-studio-breadcrumb{display:none}
.ygd-studio-filter-row{display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:12px;font-size:12px;color:var(--ds-text-secondary)}
.ygd-studio-filter-row input{width:280px;max-width:100%;min-width:0;flex:0 1 280px}
.ygd-studio-bundles-list[aria-label="Mounted Bundles"]{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.ygd-studio-bundles-list[aria-label="Mounted Bundles"] .ygd-studio-bundle-item{display:flex;flex-direction:column;align-items:stretch;padding:15px}
.ygd-studio-bundles-list[aria-label="Mounted Bundles"] .ygd-studio-kitmark{width:28px;height:28px;border-radius:7px;margin-bottom:8px}
.ygd-studio-bundles-list[aria-label="Mounted Bundles"] .ygd-studio-kitmark svg{width:18px;height:18px}
.ygd-studio-bundles-list[aria-label="Mounted Bundles"] .ygd-studio-bundle-actions{border-top:1px solid var(--ds-border);padding-top:10px}
.ygd-studio-bundles-list[aria-label="Mounted Bundles"] .ygd-studio-bundle-id{display:none}
.ygd-studio-mindset-document{padding:18px 24px;overflow:auto;flex:1;min-height:0}
.ygd-studio-mindset-info{padding:16px;border:1px solid var(--ds-border);border-radius:10px;background:#fff;align-self:start;max-height:100%;overflow:auto}
.ygd-studio-mindset-info h3{font-size:14px}.ygd-studio-mindset-info p{font-size:12px;color:var(--ds-text-secondary);margin:8px 0 12px}
.ygd-studio-toc{margin-top:13px;padding-top:12px;border-top:1px solid var(--ds-border)}
.ygd-studio-toc button{display:block;width:100%;text-align:left;border:0;background:none;padding:4px 0;font:12px/1.6 var(--ds-body-font);color:var(--ds-text-secondary);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ygd-studio-installed-preview{display:flex;flex-direction:column;margin:0 20px 18px;min-height:0;flex:1;overflow:auto;border:1px solid var(--ds-border);border-radius:10px;background:#fff;padding:0}
.ygd-studio-preview-toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-size:12px;padding:6px 12px;border-bottom:1px solid var(--ds-border);color:var(--ds-text-secondary)}
.ygd-studio-preview-actions{display:flex;gap:8px;align-items:center}
.ygd-studio-preview-actions button{height:30px;min-height:30px;padding:0 10px;font-size:12px;line-height:1;border-radius:8px;display:inline-flex;align-items:center;justify-content:center}
.ygd-studio-preview-toolbar strong{color:var(--ds-text)}
.ygd-studio-preview-sample{margin-top:16px;font-size:12px}
.ygd-studio-preview-sample summary{cursor:pointer;padding:8px 0}
.ygd-studio-preview-sample textarea{display:block;width:100%;padding:12px;border:1px solid var(--ds-border);border-radius:8px;font:13px/1.6 var(--ds-mono-font);margin-bottom:8px}
.ygd-studio-mounts-inspector{margin:0 20px 14px;padding:14px;border:1px solid var(--ds-border);border-radius:10px;background:#fff;max-height:240px;overflow:auto}
.ygd-studio-mounts-inspector p{margin:8px 0;font-size:13px}
.ygd-studio-trial{display:inline-flex;vertical-align:middle;margin:0}
.ygd-studio-hero-actions .ygd-studio-trial>button{height:32px;min-height:32px;margin:0;padding:0 12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;font-size:13px}
.ygd-studio-installed-status{font-size:12px;line-height:20px;color:var(--ds-text-secondary);white-space:nowrap}
.ygd-studio-instance-menu{position:relative;display:inline-block;margin-left:auto}
.ygd-studio-instance-menu>summary{display:flex;align-items:center;justify-content:center;list-style:none;cursor:pointer;width:32px;height:32px;border:1px solid var(--ds-border);border-radius:8px;background:#fff;font-weight:600}
.ygd-studio-instance-menu>summary::-webkit-details-marker{display:none}
.ygd-studio-instance-menu>div{position:absolute;right:0;top:100%;z-index:20;min-width:160px;padding:4px;background:#fff;border:1px solid var(--ds-border);border-radius:8px;box-shadow:0 4px 16px #00000012}
.ygd-studio-instance-menu>div>button{display:block;width:100%;padding:8px;border:0;background:none;text-align:left;font:inherit;cursor:pointer;border-radius:4px;white-space:nowrap}
.ygd-studio-instance-menu>div>button:hover{background:var(--ds-primary-light)}
.ygd-studio-instance-menu>div>button[data-tone=danger]{color:var(--ds-error-text-primary,#b02d2f)}
.ygd-studio-instance-menu>div>button[data-tone=danger]:hover{background:var(--ds-error-light-bg-default,#fff5f4)}
.ygd-studio-trial select{max-width:100%;height:32px;border:1px solid var(--ds-border);border-radius:8px;background:#fff;font:inherit}
.ygd-studio-workspace button:focus-visible,.ygd-studio-workspace summary:focus-visible{outline:2px solid var(--ds-primary);outline-offset:2px}
/* Responsive */
/* Demo geometry, Yugoo brand tokens: one hero, one document toolbar, one body. */
.ygd-studio-content-header .ygd-studio-btn-primary,.ygd-studio-content-header .ygd-studio-btn-link{margin:0}
.ygd-studio-content-header .ygd-studio-catalog-link{display:inline-flex;align-items:center;gap:6px;min-height:32px;max-width:100%;margin:0 0 0 auto;color:var(--ds-primary-dark);text-decoration:none;overflow-wrap:anywhere}
.ygd-studio-catalog-link svg{flex-shrink:0}
.ygd-studio-catalog-link:focus-visible{outline:2px solid var(--ds-primary);outline-offset:2px}
.ygd-studio-sidebar-nav{padding:0}
.ygd-studio-sidebar-item{display:flex;align-items:center;gap:10px}
.ygd-studio-sidebar-item .ygd-studio-kitmark{width:18px;height:18px;background:none;color:inherit;border-radius:0}
.ygd-studio-sidebar-item .ygd-studio-kitmark svg{width:18px;height:18px}
.ygd-studio-kitmark{background:var(--ds-primary-light);color:var(--ds-primary-dark)}
.ygd-studio-content-pane{display:flex;flex-direction:column;padding:0;overflow:hidden}
.ygd-studio-content-pane>.ygd-studio-doc-toolbar{margin:0;padding:9px 14px;border-bottom:1px solid var(--ds-border)}
.ygd-studio-document-body{flex:1;min-height:0;overflow:auto;padding:18px 24px}
.ygd-studio-document-body:has(>.ygd-studio-loading),.ygd-studio-live-pane-body:has(>.ygd-studio-loading){display:flex;flex-direction:column}
.ygd-studio-file-metadata{margin-bottom:18px;border-radius:8px;background:var(--ds-primary-light,#f7f4fe);color:var(--ds-text-secondary)}
.ygd-studio-file-metadata>summary{padding:12px;font-size:12px;cursor:pointer}
.ygd-studio-file-metadata .ygd-studio-frontmatter{margin:0;border:0;background:transparent}
.ygd-studio-document-body:has(>.ygd-studio-code-frame){padding:0}
.ygd-studio-mindset-document .ygd-studio-markdown,.ygd-studio-document-body .ygd-studio-markdown{max-width:none}
.ygd-studio-mindset-document .ygd-studio-markdown h1,.ygd-studio-document-body .ygd-studio-markdown h1{font-size:22px;margin-bottom:14px}
.ygd-studio-mindset-document .ygd-studio-markdown h2,.ygd-studio-document-body .ygd-studio-markdown h2{font-size:17px;margin:23px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--ds-border)}
.ygd-studio-doc-toolbar{min-height:51px;gap:10px;flex-wrap:wrap}
.ygd-studio-doc-toggle-group{border:0;background:var(--ds-background);padding:3px;gap:2px}
.ygd-studio-doc-toggle{background:transparent;border-radius:5px;padding:4px 9px}
.ygd-studio-doc-toggle+.ygd-studio-doc-toggle{border:0}
.ygd-studio-doc-toggle[aria-pressed="true"]{background:#fff;color:var(--ds-text);box-shadow:0 1px 3px #0001}
.ygd-studio-doc-footer{display:flex;align-items:center;gap:12px;padding:7px 14px;border-top:1px solid var(--ds-border);font-size:11px;color:var(--ds-text-secondary);flex-shrink:0}
.ygd-studio-doc-footer>span:last-child{margin-left:auto}
.ygd-studio-doc-footer button{font-size:11px;padding:0}
.ygd-studio-inline-actions{display:inline-flex;align-items:center;gap:6px;font-size:12px}
.ygd-studio-inline-actions button{font:inherit;padding:7px 11px;border:0;border-radius:8px;background:var(--ds-primary-light);color:var(--ds-primary-dark);cursor:pointer}
.ygd-studio-inline-actions button:disabled{opacity:.5;cursor:default}
.ygd-studio-mindset-info>.ygd-studio-btn-link{background:var(--ds-primary-light);color:var(--ds-primary-dark);padding:8px 11px}
.ygd-studio-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.ygd-studio-card-top .ygd-studio-kitmark{width:28px;height:28px;border-radius:7px}
.ygd-studio-card-top .ygd-studio-kitmark svg{width:18px;height:18px}
.ygd-studio-card-pill{font-size:11px;border:1px solid var(--ds-border);border-radius:5px;padding:2px 6px;color:var(--ds-text-secondary)}
.ygd-studio-card-pill-action{background:transparent;font-family:inherit;cursor:pointer;line-height:inherit}
.ygd-studio-card-pill-action:hover{color:var(--ds-text-primary);border-color:var(--ds-text-secondary)}
.ygd-studio-card-pill-action:focus-visible{outline:2px solid var(--ds-accent);outline-offset:2px}
.ygd-studio-import-actions{display:flex;align-items:center;gap:4px}
.ygd-studio-import-warning{color:var(--ds-warning,#a86712);text-align:left;align-self:flex-start}
.ygd-studio-import-issues{padding-left:20px;max-height:40vh;overflow:auto}

.ygd-studio-source-id{font:11px/1.6 var(--ds-mono-font);color:var(--ds-text-secondary);margin-top:2px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ygd-studio-kit-card .ygd-studio-card-description{margin:8px 0 12px;min-height:0}
.ygd-studio-kit-card-actions{display:flex;align-items:center;gap:5px;margin-top:auto}
.ygd-studio-kit-card-actions button{font-size:12px;padding:5px 8px}
.ygd-studio-workplane-tab[aria-selected="true"],.ygd-studio-workplane-tab[aria-pressed="true"]{color:var(--ds-text)}
@media(max-width:1023px){
  .ygd-studio-sidebar{position:absolute;left:0;top:0;bottom:0;z-index:var(--ds-z-drawer);visibility:hidden;opacity:0;
    transition:opacity var(--ds-duration-normal);width:200px;max-width:100%;padding-top:calc(var(--ds-space-2) + 28px + var(--ds-space-3))}
  .ygd-studio-sidebar.open{visibility:visible;opacity:1}
  .ygd-studio-menu-btn{display:flex;position:absolute;top:var(--ds-space-2);left:var(--ds-space-2);z-index:calc(var(--ds-z-drawer) + 1)}
  .ygd-studio-content-header{padding-left:48px}
  .ygd-studio-file-tree-pane{width:180px}
  .ygd-studio-summary-grid{grid-template-columns:minmax(0,1fr)}
  .ygd-studio-topbar{padding-left:48px}
  .ygd-studio-mindset-layout{grid-template-columns:minmax(0,1fr)}
  .ygd-studio-mindset-info{max-height:140px}.ygd-studio-toc{display:none}
}
.ygd-studio-hero-actions button{box-sizing:border-box;height:32px;min-height:32px;margin-top:0;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;line-height:1}
.ygd-studio-preview-slot,.ygd-studio-trial-slot{flex:1;min-height:0;min-width:0;display:flex;overflow:hidden;background:#fff}
.ygd-studio-preview-slot[hidden],.ygd-studio-trial-slot[hidden],.ygd-studio-trial-workspace[hidden],.ygd-studio-trial-input[hidden]{display:none}
.ygd-studio-trial-workspace{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;width:100%}
.ygd-studio-trial-history{display:flex;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid var(--ds-border);font-size:12px;flex-wrap:wrap}
.ygd-studio-trial-history button,.ygd-studio-trial-history select{height:30px;box-sizing:border-box}
.ygd-studio-trial-workarea{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);flex:1;min-height:0}
.ygd-studio-trial-result{grid-column:2;grid-row:1;min-width:0;min-height:0;display:flex;flex-direction:column}.ygd-studio-trial-result iframe{width:100%;flex:1;min-height:0;border:0;background:#fff}.ygd-studio-trial-result-details{padding:6px 12px;border-top:1px solid var(--ds-border);font-size:12px;max-height:150px;overflow:auto}
.ygd-studio-trial-input{grid-column:1;grid-row:1;display:flex;flex-direction:column;gap:12px;border-right:1px solid var(--ds-border);padding:12px;overflow:auto;min-width:0;min-height:0;font-size:12px}.ygd-studio-trial-input h3{font-size:13px;margin:0}.ygd-studio-trial-input textarea{width:100%;box-sizing:border-box;flex:1;min-height:120px;resize:none;padding:12px;margin:0;font:inherit;line-height:1.65;border:1px solid var(--ds-border);border-radius:8px}.ygd-studio-trial-input pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
.ygd-studio-trial-slot{margin:0;border:0;border-radius:0}
.ygd-studio-trial-save{display:flex;align-items:center;justify-content:flex-end;flex-shrink:0;gap:8px;padding:10px 16px;border-top:1px solid var(--ds-border);background:#fff}
.ygd-studio-trial-save .ygd-studio-trial-hint{margin:0 auto 0 0;font-size:12px;color:var(--ds-text-secondary)}
.ygd-studio-trial-save button{height:32px;white-space:nowrap}
.ygd-studio-trial-input-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}
.ygd-studio-trial-input .ygd-studio-trial-input-heading h3{margin:0}
.ygd-studio-trial-status{font-size:11px;line-height:20px;padding:0 7px;border-radius:10px;background:var(--ds-background);color:var(--ds-text-secondary);white-space:nowrap}
.ygd-studio-trial-status[data-state="waiting"],.ygd-studio-trial-status[data-state="completed"]{background:var(--ds-primary-light);color:var(--ds-primary)}
.ygd-studio-trial-status[data-state="failed"]{color:#b42318;background:#fff1ef}
.ygd-studio-workspace button:disabled{opacity:.45;cursor:not-allowed}
.ygd-studio-bundle-main .ygd-studio-installed-preview{position:relative;margin:0;flex:1;min-height:0;overflow:auto;padding:8px 16px}
.ygd-studio-editor-heading{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--ds-border);font-size:13px}
.ygd-studio-editor-heading>span{margin-left:auto;color:var(--ds-text-secondary);font-size:12px}
.ygd-studio-panel-split,.ygd-studio-trial-workarea.with-input{grid-template-columns:minmax(260px,32%) minmax(0,1fr)}
.ygd-studio-panel-split{display:grid;grid-template-rows:minmax(0,1fr);flex:1;min-width:0;min-height:0;overflow:hidden}
.ygd-studio-yaml-pane,.ygd-studio-live-pane{display:flex;flex-direction:column;min-width:0;min-height:0}
.ygd-studio-yaml-pane{border-right:1px solid var(--ds-border)}
.ygd-studio-yaml-pane>header,.ygd-studio-live-pane>header{display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid var(--ds-border);min-height:34px;font-size:12px}
.ygd-studio-yaml-pane>header>span,.ygd-studio-live-pane>header>span{color:var(--ds-text-secondary);font-size:11px}
.ygd-studio-yaml-pane>header>button,.ygd-studio-live-pane>header>button{margin-left:auto;height:30px}
.ygd-studio-yaml-pane>textarea{flex:1;min-height:0;resize:none;border:0;outline-offset:-2px;padding:12px;background:#fafafa;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2}
.ygd-studio-live-pane-body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;padding:0}
.ygd-studio-workspace .ygd-studio-trial-availability{padding:16px;max-width:400px;margin:auto;text-align:center;color:var(--ds-text-secondary);font-size:13px;line-height:1.6}
.ygd-studio-trial-input>.ygd-studio-loading{flex:1}
.ygd-studio-editor-errors{max-height:120px;overflow:auto;padding:0 12px;font-size:12px;color:#b42318}
.ygd-studio-trial-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
.ygd-studio-trial-columns>section{min-width:0;padding:16px;border:1px solid var(--ds-border);border-radius:10px;font-size:13px}
.ygd-studio-trial-columns h3{margin:0 0 12px;font-size:14px}.ygd-studio-trial-columns textarea{display:block;box-sizing:border-box;width:100%;margin:8px 0 12px;resize:vertical;font:inherit;line-height:1.6;padding:10px;border:1px solid var(--ds-border);border-radius:8px}
.ygd-studio-trial-columns pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.ygd-studio-trial-columns details{margin:12px 0}.ygd-studio-trial-hint{color:var(--ds-text-secondary);font-size:12px}
@media(max-width:650px){.ygd-studio-trial-columns{grid-template-columns:minmax(0,1fr)}.ygd-studio-file-tree-pane{width:150px}.ygd-studio-content-pane{padding:12px}}

.ygd-studio-inline-diff{flex:1;min-height:0;overflow:auto;margin:0;padding:12px 0;background:var(--ds-surface);font:13px/1.7 var(--ds-mono-font);tab-size:2}
.ygd-studio-diff-line{display:flex;min-width:max-content;min-height:1.7em;padding:0 16px 0 8px}
.ygd-studio-diff-line code{font:inherit;white-space:pre}
.ygd-studio-diff-sign{display:inline-block;flex:0 0 24px;user-select:none;text-align:center;color:var(--ds-text-secondary)}
.ygd-studio-diff-line[data-change=added]{background:color-mix(in srgb,var(--ds-success) 10%,var(--ds-surface))}
.ygd-studio-diff-line[data-change=removed]{background:color-mix(in srgb,var(--ds-error) 10%,var(--ds-surface))}
.ygd-studio-diff-line[data-change=added] .ygd-studio-diff-sign{color:var(--ds-success)}
.ygd-studio-diff-line[data-change=removed] .ygd-studio-diff-sign{color:var(--ds-error)}
.ygd-studio-kit-file-source{padding:16px;white-space:pre-wrap;font:13px/1.7 var(--ds-mono-font,ui-monospace,monospace)}
.ygd-studio-bundle-mount-choice{display:flex;align-items:center;gap:8px;padding:6px}
.ygd-studio-bundle-mount-choice>input[type=checkbox]{appearance:auto;font:inherit;accent-color:var(--ds-primary);margin:0}
`
