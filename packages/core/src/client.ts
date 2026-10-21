/**
 * dsh-design-core — browser half: mounts the generated `designPanel` Remote
 * descriptor as a platform namespace service. The mount lives in its own boot
 * entry (the `dsh-api-remotes` pattern): the consuming panel entry declares
 * `remote.designPanel` in inject, so it cannot provide the namespace itself
 * without deadlocking its own activation.
 */
import type { Context } from '@deepseek-ai/cordis'
import TYPERT_REMOTE from './typert.remote-client.ts'

/** Required service: the typed Client Remote gateway. */
export const inject = ['remote']

/**
 * Mount the `designPanel` namespace; activation settles after the service is
 * ready so downstream entries can declare it in inject.
 * @param ctx - client root context.
 * @returns disposer that unmounts the namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const face = ctx as unknown as {
    remote: { $mount: (contribution: unknown) => Promise<() => Promise<void>> }
  }
  return await face.remote.$mount(TYPERT_REMOTE)
}
