/** Shared DSH browser adapter values, independently testable from client boot. */
import { useSyncExternalStore, type CSSProperties, type ReactElement } from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { StudioManagementClient } from 'dsh-design-studio-ui'
import { isDshDesktopLocation, STUDIO_PAGE_BASE, studioConversationReturnPath } from './page-path.ts'

interface LocaleSnapshot {
  readonly active: string
  readonly revision: number
}

/** Browser services used by the Studio settings section. */
export interface DshStudioSettingsRuntime {
  readonly locale: {
    getSnapshot(): LocaleSnapshot
    subscribe(listener: () => void): () => void
  }
}

interface DshStudioSettingsSectionProps extends SettingsSectionOwnerProps {
  readonly locale: DshStudioSettingsRuntime['locale']
}

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  maxWidth: 760,
  color: 'var(--dsw-alias-label-primary)',
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 12,
  padding: 18,
  background: 'var(--dsw-alias-bg-layer-1)',
}

const secondaryTextStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  lineHeight: 1.55,
}

/** DSH Remote gateway settlement for one call. */
export type DshRemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code?: string; readonly message?: string } }

/** Remote namespace methods used by the Studio client. */
export interface DshStudioRemote {
  workspace(query: string): Promise<DshRemoteResult<Awaited<ReturnType<StudioManagementClient['workspace']>>>>
  readKitWorkspace(name: string, version: string): Promise<DshRemoteResult<Awaited<ReturnType<StudioManagementClient['readKitWorkspace']>>>>
  readKitFiles(name: string, version: string): Promise<DshRemoteResult<Awaited<ReturnType<NonNullable<StudioManagementClient['readKitFiles']>>>>>
  readKitFile(name: string, version: string, path: string): Promise<DshRemoteResult<Awaited<ReturnType<NonNullable<StudioManagementClient['readKitFile']>>>>>
  readBundleWorkspace(name: string, version?: string): Promise<DshRemoteResult<Awaited<ReturnType<StudioManagementClient['readBundleWorkspace']>>>>
  readBundleFile(name: string, path: string, version?: string): Promise<DshRemoteResult<Awaited<ReturnType<StudioManagementClient['readBundleFile']>>>>
}

/** Build the shared client over DSH's generated Remote namespace. */
export function createDshStudioClient(remote: DshStudioRemote): StudioManagementClient {
  const unwrap = async <T,>(method: string, response: Promise<DshRemoteResult<T>>): Promise<T> => {
    const settled = await response
    if (!settled.ok) throw new Error(`studioManagement/${method}: ${settled.error.message ?? settled.error.code ?? 'request failed'}`)
    return settled.value
  }
  return Object.freeze({
    workspace: (query: string) => unwrap('workspace', remote.workspace(query)),
    readKitWorkspace: async (name: string, version: string) => {
      const result = await unwrap('readKitWorkspace', remote.readKitWorkspace(name, version))
      if (result.workspace === undefined || result.workspace.relationVocabulary !== undefined) return result
      return Object.freeze({
        ...result,
        workspace: Object.freeze({
          ...result.workspace,
          relationVocabulary: Object.freeze({ schemaVersion: 1 as const, pin: 'legacy-unavailable', relations: Object.freeze([]) }),
        }),
      })
    },
    readKitFiles: (input: { name: string; version: string }) => unwrap('readKitFiles', remote.readKitFiles(input.name, input.version)),
    readKitFile: (input: { name: string; version: string; path: string }) => unwrap('readKitFile', remote.readKitFile(input.name, input.version, input.path)),
    readBundleWorkspace: (name: string, version?: string) => unwrap('readBundleWorkspace', remote.readBundleWorkspace(name, version)),
    readBundleFile: (input: { name: string; path: string; version?: string }) => unwrap('readBundleFile', remote.readBundleFile(input.name, input.path, input.version)),
  })
}

/** Launcher URL; one shared browser-safe constant owns the route path. */
export { STUDIO_PAGE_BASE as STUDIO_PAGE_URL } from './page-path.ts'

/**
 * Settings-shell launcher for the full-page Studio workspace. Web opens a
 * separate noopener page; Desktop follows its existing same-window app route.
 * @param actions - Settings owner affordances.
 * @returns the launcher element.
 */
export function renderStudioLauncher(actions: { close(): void }, zh = false, locationHref = globalThis.location?.href): ReactElement {
  const desktop = isDshDesktopLocation(locationHref)
  return <div className="ygd-studio-launcher" style={cardStyle}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {zh ? 'Kit 与 Bundle 工作区' : 'Kit and Bundle workspace'}
        </h3>
        <p style={{ ...secondaryTextStyle, margin: '6px 0 0' }}>
          {desktop ? (zh
            ? '在当前窗口中查看预制 Kit、Mindset、挂载的 Bundles 及其源文件。查看后可点击「返回对话」。'
            : 'Inspect shipped Kits, Mindsets, mounted Bundles, and their source files in this window. Use “Back to conversation” to return.') : zh
            ? '在独立页面中查看预制 Kit、Mindset、挂载的 Bundles 及其源文件。打开 Studio 不会中断当前对话。'
            : 'Inspect shipped Kits, Mindsets, mounted Bundles, and their source files in a dedicated workspace. Opening Studio leaves this conversation untouched.'}
        </p>
      </div>
      <span style={{ flex: '0 0 auto', borderRadius: 999, padding: '3px 8px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>
        {zh ? '1.0 只读' : '1.0 read-only'}
      </span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
      <a
        className="ygd-studio-launch-link"
        href={STUDIO_PAGE_BASE}
        target={desktop ? '_self' : '_blank'}
        rel={desktop ? undefined : 'noopener noreferrer'}
        onClick={() => actions.close()}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 34, borderRadius: 8, padding: '0 14px', background: 'var(--dsw-alias-brand-primary)', color: 'white', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}
      >
        {zh ? '打开 Design Studio' : 'Open Design Studio'}
      </a>
      <code className="ygd-studio-launch-url" style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{STUDIO_PAGE_BASE}</code>
    </div>
  </div>
}

/** Compact Desktop page navigation, independent of the shared Studio workspace. */
export function renderStudioReturnNavigation(zh = false, locationHref = globalThis.location?.href): ReactElement | null {
  const returnPath = studioConversationReturnPath(locationHref)
  if (returnPath === undefined) return null
  return <nav
    aria-label={zh ? '应用导航' : 'Application navigation'}
    className="ygd-studio-return-navigation"
    style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto', padding: '8px 12px', borderBottom: '1px solid var(--dsw-alias-border-l1, #E8E8E8)', background: 'var(--dsw-alias-bg-layer-1, #FFFFFF)', fontFamily: "'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif" }}
  >
    <a
      href={returnPath}
      target="_self"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '0 8px', borderRadius: 6, color: 'var(--dsw-alias-label-primary, #272727)', fontSize: 13, textDecoration: 'none' }}
    >
      <span aria-hidden="true">←</span>
      {zh ? '返回对话' : 'Back to conversation'}
    </a>
  </nav>
}

/** Design Studio settings page with the launcher only. */
export function DshStudioSettingsSection(props: DshStudioSettingsSectionProps): ReactElement {
  const language = useSyncExternalStore(
    listener => props.locale.subscribe(listener),
    () => props.locale.getSnapshot(),
    () => props.locale.getSnapshot(),
  ).active
  const zh = language === 'zh'

  return <section className="ygd-studio-settings" style={sectionStyle}>
    <header>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{zh ? 'Design Studio' : 'Design Studio'}</h2>
      <p style={{ ...secondaryTextStyle, margin: '6px 0 0' }}>
        {zh ? '查看设计工具包，并配置设计系统在对话中的辅助行为。' : 'Inspect design kits and configure how the Design System assists the conversation.'}
      </p>
    </header>
    {renderStudioLauncher({ close: props.close }, zh)}
  </section>
}

/** Minimal slot face required to install the Studio Settings contribution. */
export interface DshStudioSlots {
  inject(name: string, contribution: () => () => void): void
  register(spec: Record<string, unknown>, component: unknown): () => void
}

/** Register the root-scoped Studio Settings launcher for the caller's fiber. */
export function registerDshStudioSettings(host: { readonly slots: DshStudioSlots } & DshStudioSettingsRuntime): void {
  const Section = (props: SettingsSectionOwnerProps): ReactElement => <DshStudioSettingsSection
    {...props}
    locale={host.locale}
  />
  host.slots.inject('settings.section', () => host.slots.register({
    name: 'settings.section',
    id: 'design-studio',
    order: 40,
    label: () => host.locale.getSnapshot().active === 'zh' ? '设计工作室' : 'Design Studio',
    inject: () => ({}),
  }, Section))
}
