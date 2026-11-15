/** Container-sized navigation: a dock can be narrow even on a wide desktop. */
export const EXPERIENCE_CSS = `
.dsh-experience-workspace{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0}
.dsh-experience-body{flex:1;min-height:0;min-width:0}
.dsh-experience-footer{display:flex;align-items:center;gap:8px;overflow-x:auto}
.dsh-experience-footer>*{flex-shrink:0}
.dsh-experience{container-type:inline-size;container-name:experience;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;background:var(--ds-fill-1,#fff);color:var(--ds-text-primary,#272727);font:inherit}
.dsh-experience *{box-sizing:border-box}
.dsh-experience-layout{display:flex;flex:1;min-height:0;min-width:0}
/* Typography, button geometry, hover and selection come from shared declarative navigation. */
.dsh-experience-directory{width:220px;flex:0 0 220px;overflow:auto;background:var(--ds-fill-1,#fff);border-right:1px solid var(--ds-line-1,#e5e7eb)}
.dsh-experience-directory-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-experience-directory-heading h2{min-width:0}
.dsh-experience-directory-heading-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.dsh-experience-directory-title{display:inline-flex;align-items:center;gap:6px}
.dsh-experience-info{display:inline-flex;align-items:center;color:var(--ds-text-tertiary,#6d6d6d);cursor:help}
.dsh-experience-count{color:var(--ds-text-tertiary,#6d6d6d)}
.dsh-experience-directory .dsh-panel-workspace-nav-items{display:grid;min-width:0}
.dsh-experience-directory .dsh-panel-workspace-nav-items button{min-width:0;white-space:normal;overflow-wrap:anywhere}
.dsh-experience-nav-group{min-width:0}
.dsh-experience-directory button:disabled{cursor:not-allowed;opacity:.5}
.dsh-experience-directory button:disabled:hover{background:transparent}
.dsh-experience-sections{margin:6px 0 0 10px;padding-left:7px;border-left:1px solid var(--ds-line-1,#ddd)}
.dsh-experience-content{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:auto}
.dsh-experience-heading{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;flex-shrink:0;padding:12px 16px 6px}
.dsh-experience-heading h2{margin:0;min-width:0;overflow-wrap:anywhere}
.dsh-experience-disclaimer{font-size:12px;color:var(--ds-text-secondary,#4c4c4c);white-space:normal}
.dsh-experience-evidence{flex-shrink:0;padding:0 16px 10px;font-size:12px;color:var(--ds-text-secondary,#4c4c4c)}
.dsh-experience-evidence summary{cursor:pointer;width:fit-content}
.dsh-experience-evidence-body{max-height:180px;overflow:auto;padding:8px 0;overflow-wrap:anywhere}
.dsh-experience-evidence-body p{margin:0 0 8px}
.dsh-experience-evidence-body h3{font-size:12px;margin:10px 0 4px;color:var(--ds-text-primary,#272727)}
.dsh-experience-evidence-body ul{margin:0 0 8px;padding-left:20px}
.dsh-experience-warning{flex-shrink:0;margin:0;padding:6px 16px;background:var(--ds-warning-light-bg-default,#fffbf5);color:var(--ds-warning-text-primary,#a45300);font-size:12px;overflow-wrap:anywhere}
.dsh-experience-canvas{flex:1;min-height:240px;border-top:1px solid var(--ds-line-1,#e5e7eb);background:var(--ds-bg-white,#fff)}
.dsh-experience-canvas iframe{display:block;width:100%;height:100%;min-height:240px;border:0}
.dsh-experience-actions{display:flex;align-items:center;flex-shrink:0;gap:8px;margin-left:auto}
.dsh-experience-actions button{height:32px}
.dsh-experience-error{margin:0;padding:8px 16px;max-height:100px;overflow:auto;overflow-wrap:anywhere;color:var(--ds-error-text-primary,#b02d2f);flex-shrink:0}
.dsh-experience-directory-toggle{display:none}
@container experience (max-width:640px){
 .dsh-experience-layout{flex-direction:column}
 .dsh-experience-directory-toggle{display:block;flex-shrink:0;text-align:left;padding:10px 14px;background:var(--ds-fill-1,#fbfbfb);border:0;border-bottom:1px solid var(--ds-line-1,#e5e7eb);color:inherit;cursor:pointer}
 .dsh-experience-directory{display:none;width:100%;flex:0 0 auto;max-height:180px;border-right:0;border-bottom:1px solid var(--ds-line-1,#e5e7eb)}
 .dsh-experience-directory.is-open{display:block}
 .dsh-experience-heading{padding:10px 12px 6px}
 .dsh-experience-evidence{padding:0 12px 8px}
}
`
