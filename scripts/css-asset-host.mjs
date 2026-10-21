import { loadPackagedCssAssets } from './css-asset-manifest.mjs'

/** Attach an HTTP carrier only while the official optional service is present.
 * The injected child owns registrations, so service replacement/plugin unload
 * removes them. This does not implement Electron's file/IPC carrier.
 */
export function attachPackagedCssAssetRoutes(ctx, packageRoot, prefixes) {
  if (typeof ctx?.inject !== 'function') throw Error('Official lifecycle injection required for CSS assets')
  return ctx.inject(['webServer'], child => {
    if (typeof child?.effect !== 'function') throw Error('Official effect lifecycle required for CSS assets')
    child.effect(() => registerPackagedCssAssets(child.webServer, packageRoot, prefixes))
  })
}

/** Match the official webServer.register route/disposer contract.
 * Asset tables are verified before the first registration. Call within the
 * owning plugin lifecycle and existing host access policy; no fallback seat
 * or upstream /plugins route is claimed by this helper.
 */
export function registerPackagedCssAssets(webServer, packageRoot, prefixes) {
  if (typeof webServer?.register !== 'function' || !Array.isArray(prefixes) || !prefixes.length || new Set(prefixes).size !== prefixes.length) throw Error('Explicit CSS route service and unique prefixes required')
  const tables = prefixes.map(prefix => ({ prefix, ...loadPackagedCssAssets(packageRoot, prefix) }))
  const disposers = []
  try {
    for (const table of tables) {
      const dispose = webServer.register({ kind: 'prefix', path: table.prefix.slice(0, -1), handler: table.handler })
      if (typeof dispose !== 'function') throw Error('Host CSS registration did not return a disposer')
      disposers.push(dispose)
    }
  } catch (error) {
    const failures = []
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch (cleanupError) { failures.push(cleanupError) }
    }
    if (failures.length) throw new AggregateError([error, ...failures], 'CSS route registration and rollback failed')
    throw error
  }
  let closed = false
  return () => {
    if (closed) return
    closed = true
    const failures = []
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'CSS route disposal failed')
  }
}
