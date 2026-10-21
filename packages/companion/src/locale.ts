/** Companion-local UI preference, independent of DSH and project design facts. */
export type CompanionLanguage = 'auto' | 'en' | 'zh'
export const COMPANION_LANGUAGE_KEY = 'design-companion-language'
const chromeZh = {
  sidebar: '侧边栏', collapseSidebar: '收起侧边栏', expandSidebar: '展开侧边栏',
  conversation: '对话', collapseConversation: '收起对话', expandConversation: '展开对话',
  backgroundReviews: '后台评审', closeBackgroundReviews: '关闭后台评审', pending: '待处理', running: '运行中',
  settings: '设置', designSettings: '设计系统设置', closeSettings: '关闭设置',
  language: '语言', browserDefault: '跟随浏览器',
  designSuggestions: '设计建议', maxSuggestions: '最大建议数', saveSettings: '保存设置', settingsSaved: '设置已保存',
  display: '显示', restoreChatLayout: '恢复聊天与设计区 3:7',
  designStudio: 'Design Studio', studioDescription: '查看当前安装的 Kit、Mindset、Bundle 和源文件。只读浏览，不中断对话。',
  openStudio: '打开 Studio', closeStudio: '关闭 Studio',
  nativeConnection: '原生连接', connecting: '连接中',
  nativeConnectionDescription: '权限审批和原生问题仍在 {host} 中处理。此处不修改模型、权限或账号设置。',
} as const
const chromeEn: Record<keyof typeof chromeZh, string> = {
  sidebar: 'Sidebar', collapseSidebar: 'Collapse sidebar', expandSidebar: 'Expand sidebar',
  conversation: 'conversation', collapseConversation: 'Collapse conversation', expandConversation: 'Expand conversation',
  backgroundReviews: 'Background reviews', closeBackgroundReviews: 'Close background reviews', pending: 'Needs attention', running: 'Running',
  settings: 'Settings', designSettings: 'Design System settings', closeSettings: 'Close settings',
  language: 'Language', browserDefault: 'Browser default',
  designSuggestions: 'Design suggestions', maxSuggestions: 'Maximum suggestions', saveSettings: 'Save settings', settingsSaved: 'Settings saved',
  display: 'Display', restoreChatLayout: 'Restore chat and design areas to 3:7',
  designStudio: 'Design Studio', studioDescription: 'Browse installed Kits, Mindsets, Bundles and source files. Read-only browsing keeps your conversation open.',
  openStudio: 'Open Studio', closeStudio: 'Close Studio',
  nativeConnection: 'Native connection', connecting: 'Connecting',
  nativeConnectionDescription: 'Permission approvals and native questions are still handled in {host}. Model, permission and account settings are not changed here.',
}
export type CompanionChromeKey = keyof typeof chromeZh
/** Only Companion-owned chrome; never translates project facts or native messages. */
export function companionChromeText(key: CompanionChromeKey, locale: string, values?: { host: string }): string {
  const text = (locale.toLowerCase().startsWith('zh') ? chromeZh : chromeEn)[key]
  return values ? text.replaceAll('{host}', values.host) : text
}
export function companionDocumentLanguage(locale: string): 'zh-CN' | 'en' {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
export function createCompanionLocale(storage?: Pick<Storage, 'getItem' | 'setItem'>, browserLanguage = 'en') {
  let preference: CompanionLanguage = 'auto'
  try {
    const saved = storage?.getItem(COMPANION_LANGUAGE_KEY)
    if (saved === 'en' || saved === 'zh') preference = saved
  } catch { /* Private browsing still permits a session-local selection. */ }
  const resolve = () => preference === 'auto' ? browserLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en' : preference
  let snapshot = { active: resolve() }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    getPreference: () => preference,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setPreference(value: CompanionLanguage, persist = true) {
      if (!['auto', 'en', 'zh'].includes(value)) throw new Error('Unsupported Companion language')
      preference = value
      try { if (persist) storage?.setItem(COMPANION_LANGUAGE_KEY, value) } catch { /* Keep in-memory choice. */ }
      snapshot = { active: resolve() }
      for (const listener of listeners) listener()
    },
  }
}
