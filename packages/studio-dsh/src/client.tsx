/** DSH browser adapter contributing the Design Studio launcher only. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { registerDshStudioSettings } from './client-adapter.tsx'

/** Required browser services; the full-page Studio owns its own Remote boot. */
export const inject = ['slots', 'locale']

/** Contribute one lifecycle-owned global Settings launcher. */
export async function apply(ctx: Context): Promise<void> {
  const face = ctx as unknown as {
    slots: {
      inject(name: string, contribution: () => () => void): void
      register(spec: Record<string, unknown>, component: unknown): () => void
    }
    locale: {
      getSnapshot(): { readonly active: string; readonly revision: number }
      subscribe(listener: () => void): () => void
    }
  }
  registerDshStudioSettings(face)
}
