import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react'

interface CardDraft {
  base: Record<string, unknown>
  values: Record<string, unknown>
}

function createDraftStore() {
  const drafts = new Map<string, CardDraft>()
  const listeners = new Set<() => void>()
  return {
    get: (key: string) => drafts.get(key),
    set: (key: string, draft: CardDraft | undefined) => {
      if (draft) drafts.set(key, draft)
      else drafts.delete(key)
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const CardDraftContext = createContext<ReturnType<typeof createDraftStore> | undefined>(undefined)

/** Transient editor input survives record selection, only for this workspace's
 * lifetime. Save still uses the existing transaction; Cancel discards the input.
 */
export function RecordCardDraftScope({ children }: { children: ReactNode }) {
  const [store] = useState(createDraftStore)
  return <CardDraftContext.Provider value={store}>{children}</CardDraftContext.Provider>
}

export function useRecordCardDraft(key: string) {
  const shared = useContext(CardDraftContext)
  const [local] = useState(createDraftStore)
  const store = shared ?? local
  const draft = useSyncExternalStore(store.subscribe, () => store.get(key), () => store.get(key))
  return [draft, (value: CardDraft | undefined) => store.set(key, value)] as const
}
