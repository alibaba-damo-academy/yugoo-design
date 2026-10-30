/** Export and stateless archive decoding over the current S2 source authority. */
import { readStudioContentArchive } from 'dsh-design-studio'
import type { StudioInstances } from 'dsh-design-studio/node'
import type { DesignBundleVersionPin, DesignKitVersionPin } from 'dsh-design-studio'

type InstalledExport = { readonly kind: 'kit' | 'bundle'; readonly pin: DesignBundleVersionPin | DesignKitVersionPin;
  readonly provenance?: { readonly source?: string; readonly license?: string } }
export async function createDshStudioContent({ instances }: {
  instances: Pick<StudioInstances, 'editCurrent' | 'exportArchive'>
}) {
  return {
    readArchive: async ({ source }: { source: string }) => readStudioContentArchive(source),
    async exportContentArchive(input: InstalledExport | Parameters<StudioInstances['exportArchive']>[0]) {
      if ('id' in input) return instances.exportArchive(input)
      const current = await instances.editCurrent({ kind: input.kind, [input.kind]: input.pin })
      return instances.exportArchive({ id: current.id, expectedRevision: current.revision, provenance: input.provenance })
    },
  }
}
export type DshStudioContent = Awaited<ReturnType<typeof createDshStudioContent>>
