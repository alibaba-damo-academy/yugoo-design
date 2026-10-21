/** Optional settings service bridge; lifecycle ownership stays with the host. */
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import * as settingsModule from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** Plugin consumer hooks; the Host owns the live source and its persistence. */
interface SettingsSectionHooks<T> {
  setSource(current: () => T): void
  onChange(): void
}

type LegacyInstaller<T> = (owner: Context, namespace: SettingsNamespace, schema: z<T>, entry: T, hooks: SettingsSectionHooks<T>) => void
type ProviderInstaller<T> = (this: object, owner: Context, namespace: SettingsNamespace, schema: z<T>, entry: T, hooks: SettingsSectionHooks<T>) => void

/** The current Host owns live Config references; consumers can only read them. */
export function readDesignConfigValue<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  const get = Reflect.get(value, 'get')
  return typeof get === 'function' ? Reflect.apply(get, value, []) as T : value
}

/** Keep the legacy schema unchanged when that Host has no volatile Config API. */
export function designLiveConfigField<T>(field: z<T>): z<T> {
  const volatile = Reflect.get(field, 'volatile')
  return typeof volatile === 'function' ? Reflect.apply(volatile, field, []) as z<T> : field
}

function installConfigFormsSection<T>(owner: Context, scoped: Context, provider: object, schema: z<T>, entry: T, hooks: SettingsSectionHooks<T>): void {
  const fiber = owner.fiber as unknown as { config: Record<string, unknown>; runtime: { Config?: z<unknown> }; state: number }
  const fields = Reflect.get(schema, 'dict') as Record<string, unknown> | undefined
  const configSchema = fiber.runtime.Config
  const configFields = configSchema && Reflect.get(configSchema, 'dict') as Record<string, z<unknown>> | undefined
  if (!fields || !configFields || Object.keys(fields).some(key => !configFields[key]?.meta?.volatile)) {
    throw new Error('design: current settings require owning plugin volatile Config fields')
  }
  const source = (): T => schema(Object.fromEntries(Object.keys(fields).map(key => [key, readDesignConfigValue(fiber.config[key])])) as T)
  const configure = Reflect.get(provider, 'configure')
  if (typeof configure !== 'function') throw new Error('design: settings provider lacks a supported section installation API')
  // SettingsForms discovers this exact fiber's Config through the Host editor.
  // It owns namespace identity and durable edits; no parallel settings store.
  scoped.effect(() => Reflect.apply(configure, provider, [{ auto: true }, owner.fiber]))
  let previous = JSON.stringify(source())
  hooks.setSource(source)
  hooks.onChange?.()
  const on = scoped.on as unknown as (name: string, callback: () => void) => () => void
  on.call(scoped, 'settings/document-updated', () => {
    const current = JSON.stringify(source())
    if (current === previous) return
    previous = current
    hooks.onChange?.()
  })
  scoped.effect(() => () => {
    if (fiber.state !== 2) return // consumer unload must not notify a dead scheduler
    hooks.setSource(() => entry)
    hooks.onChange?.()
  })
}

/** A fixed, plugin-owned namespace. No new user setting or host schema. */
export const DESIGN_ADVISORY_SETTINGS_NAMESPACE = 'dsh-design-advisory' as SettingsNamespace

export function installDesignSettingsSection<T>(owner: Context, schema: z<T>, entry: T, hooks: SettingsSectionHooks<T>, api: object = settingsModule): void {
  const legacy = Reflect.get(api, 'installSettingsSection')
  if (typeof legacy === 'function') {
    // Preserve the old host's existing optional injection and unload guards.
    ;(legacy as LegacyInstaller<T>)(owner, DESIGN_ADVISORY_SETTINGS_NAMESPACE, schema, entry, hooks)
    return
  }
  owner.inject(['settings'], scoped => {
    // Read the service inside the injection fiber. Calling the traced receiver
    // is essential: extracting the original provider leaks registrations.
    const provider = (scoped as unknown as { settings: object }).settings
    const install = Reflect.get(provider, 'installSection')
    if (typeof install !== 'function') {
      const forms = Reflect.get(api, 'SettingsForms')
      if (typeof forms !== 'function' || !(provider instanceof forms)) {
        throw new Error('design: settings provider lacks a supported section installation API')
      }
      installConfigFormsSection(owner, scoped, provider, schema, entry, hooks)
      return
    }
    // Synchronous registration; owner is the consumer, NOT the scoped child.
    ;(install as ProviderInstaller<T>).call(provider, owner, DESIGN_ADVISORY_SETTINGS_NAMESPACE, schema, entry, hooks)
  })
}
