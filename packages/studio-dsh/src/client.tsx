/** DSH browser adapter contributing the Settings Studio launcher. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { registerDshStudioSettings } from './client-adapter.tsx'
import type { DshStudioSettingsRuntime, DshStudioSlots } from './client-adapter.tsx'

/** Required browser services; the full-page Studio owns its own Remote boot. */
export const inject = ['slots', 'locale']

/** Studio has no persistent entry in the conversation header. */
export async function apply(ctx: Context): Promise<void> {
  const face = ctx as unknown as DshStudioSettingsRuntime & { readonly slots: DshStudioSlots }
  registerDshStudioSettings(face)
}
