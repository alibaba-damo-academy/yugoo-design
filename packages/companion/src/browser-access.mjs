/** Browser admission is a service setting, never a URL-selected permission. */
export function resolveBrowserAccess(value = 'token') {
  if (value !== 'token' && value !== 'local') throw new Error('browserAccess must be token or local.')
  return value
}

export function companionView(value) {
  return value === 'panel-only' || value === 'design' ? 'panel-only' : 'full'
}

// These are the shared UI's operations, not the native executor/tool surface.
// Keep additions explicit, even when the existing dispatcher supports more.
export const browserMethods = new Set([
  'info', 'readWorkspace', 'readConversation', 'readGraph', 'knowledgeStatus',
  'queryKnowledge', 'readArtifact', 'readBinaryArtifact', 'readExecutionLog',
  'listSkills', 'listProjects', 'listAdvisories', 'readSettings', 'readReviewPolicy',
  'savePanel', 'observePanelDraft', 'retainAutoPanel', 'sendPrompt', 'decideAdvisory', 'updateSettings',
  'updateReviewPolicy', 'retryKnowledge', 'reloadKit',
  'studioWorkspace', 'studioKit', 'studioBundle', 'studioFile',
  'studioKitFiles', 'studioKitFile', 'studioInstalledPreview',
  'studioInstanceList', 'studioInstanceRead', 'studioInstanceCopy', 'studioInstanceRename',
  'studioInstanceRemove', 'studioInstanceFile', 'studioInstanceSave',
  'studioInstancePreview', 'studioInstanceMounts',
  'studioTrialAvailability', 'studioTrialStart', 'studioTrialList', 'studioTrialRead', 'studioTrialStop', 'studioTrialRemove',
  'studioDraftList', 'studioDraftRead', 'studioDraftPreview', 'studioDraftCreate',
  'studioDraftSave', 'studioDraftConfirm', 'studioDraftFork',
  'studioKitDraftList', 'studioKitDraftRead', 'studioKitDraftValidate',
  'studioKitDraftPreview', 'studioKitDraftCreate', 'studioKitDraftSave',
  'studioKitDraftConfirm', 'studioKitDraftFork',
  'studioContentExport', 'studioContentImport', 'studioContentImportRead',
  'studioContentImportList', 'studioContentImportAdopt',
])

export function browserRequestAllowed(headers, origin) {
  return headers.origin === origin && headers['x-design-browser'] === '1'
    && (headers['sec-fetch-site'] === undefined || headers['sec-fetch-site'] === 'same-origin')
    && /^application\/json(?:\s*;|\s*$)/i.test(headers['content-type'] ?? '')
}

/** A public instance id prevents old pages from attaching to a reused port. */
export function localBrowserBase(pathname) {
  const match = /^\/browser\/[a-f0-9]{32}\/$/.exec(pathname)
  return match ? match[0] : undefined
}

/** Local mode never reads browser storage or extracts an access credential. */
export function browserTransport(location, storage) {
  const base = localBrowserBase(location.pathname)
  if (base) return { endpoint: `${base}api`, headers: { 'X-Design-Browser': '1' } }
  if (location.pathname.startsWith('/browser/')) throw new Error('Invalid Companion browser entry.')
  let saved = ''
  try { saved = storage?.getItem('design-companion-token') ?? '' } catch { /* unavailable webview storage */ }
  const token = location.hash.slice(1) || saved
  let stored = false
  try { storage?.setItem('design-companion-token', token); stored = !!storage } catch { /* retain the entry fragment */ }
  return { endpoint: '/api', headers: { 'X-Design-Token': token }, removeFragment: stored }
}
