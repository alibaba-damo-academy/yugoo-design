/** Read legacy retained closures so existing projects can materialize their actual source. */
import { DesignContentStore } from './content-store.ts'
import type { DesignBundleContent } from './kit-loader.ts'
import type { DesignKit } from './types.ts'

interface RetainedCatalog {
  registerRetainedKit(kit: DesignKit): void
  registerBundleContent(content: DesignBundleContent, options: { retained: true }): void
}

/** Restore the configured root, also usable for a previous explicit loader root. */
export async function restoreDshProjectContent(catalog: RetainedCatalog, stateRoot: string, active: () => void = () => {}): Promise<void> {
  const store = new DesignContentStore(stateRoot)
  for (const pin of await store.listBundles()) {
    const bundle = await store.resolveBundle(pin)
    active()
    if (bundle) catalog.registerBundleContent(bundle, { retained: true })
  }
  for (const pin of await store.listKits()) {
    const kit = await store.loadRetainedKit(pin)
    if (!kit?.sourceRoot) continue
    active()
    catalog.registerRetainedKit(kit)
  }
}
