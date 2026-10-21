import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react'
import { releaseFontOwner } from './ui-font-broker.mjs'
import { releaseSceneFontOwner } from './scene-font-broker.mjs'

const key = Symbol.for('dsh-design.canvas-font-owner-context.v1')
const existing = globalThis[key]
if (existing !== undefined && (existing.version !== 1 || existing.createContext !== createContext || !existing.context?.Provider)) {
  throw new Error('Incompatible canvas font ownership context')
}
const shared = existing ?? Object.freeze({ version: 1, createContext, context: createContext(undefined) })
if (existing === undefined) Object.defineProperty(globalThis, key, { value: shared, writable: false, configurable: false })
const disposedRootOwners = new WeakSet()

/** An opaque object identifies one plugin/root generation, shared by its panels. */
export function CanvasFontOwnerProvider({ owner, children }) {
  return createElement(shared.context.Provider, { value: owner }, children)
}

export function releaseCanvasFontOwner(owner) {
  disposedRootOwners.add(owner)
  releaseFontOwner(typeof document === 'undefined' ? undefined : document, owner)
  releaseSceneFontOwner(typeof document === 'undefined' ? undefined : document, owner)
}

/** React root cleanup owns a generation; StrictMode replay receives a new one. */
export function CanvasFontRoot({ children }) {
  const [owner, setOwner] = useState(() => ({}))
  const current = useRef(owner)
  useEffect(() => {
    if (disposedRootOwners.has(current.current)) {
      current.current = {}
      setOwner(current.current)
    }
    const generation = current.current
    return () => releaseCanvasFontOwner(generation)
  }, [])
  return createElement(CanvasFontOwnerProvider, { owner }, children)
}

/** A font failure reports a scoped warning; it does not block scene/image editing. */
export function useCanvasFontSession(acquire) {
  const inherited = useContext(shared.context)
  const local = useRef({})
  const owner = inherited ?? local.current
  const [error, setError] = useState(undefined)
  const [acquiredOwner, setAcquiredOwner] = useState(undefined)
  useEffect(() => {
    let active = true, lease
    setError(undefined)
    try {
      lease = acquire(typeof document === 'undefined' ? undefined : document, owner)
      setAcquiredOwner(owner)
      void lease.ready.then(result => {
        if (active && result.status === 'failed') setError('font-load-failed')
      }, () => { if (active) setError('font-load-failed') })
    } catch {
      setAcquiredOwner(owner)
      setError('font-load-failed')
    }
    return () => { active = false; lease?.release() }
  }, [acquire, owner])
  return { error, initialized: acquiredOwner === owner }
}

/** Compatibility for status-only consumers. Editors use the initialized gate. */
export function useCanvasUiFont(acquire) { return useCanvasFontSession(acquire).error }
