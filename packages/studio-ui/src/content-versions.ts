/** Display grouping over the host's installed, validated exact-version catalog. No filesystem discovery. */
export function groupInstalledContent<T extends { readonly name: string; readonly version: string }>(entries: readonly T[]): readonly {
  readonly name: string; readonly latest: T; readonly versions: readonly T[]
}[] {
  const groups = new Map<string, T[]>()
  const parse = (version: string) => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) throw new Error('Studio requires exact major.minor catalog versions')
    return version.split('.').map(BigInt)
  }
  for (const entry of entries) {
    parse(entry.version)
    const group = groups.get(entry.name) ?? []
    if (group.some(value => value.version === entry.version)) throw new Error('Studio catalog contains duplicate exact versions')
    group.push(entry); groups.set(entry.name, group)
  }
  return [...groups].map(([name, values]) => {
    const versions = values.sort((left, right) => {
      const a = parse(left.version), b = parse(right.version)
      return a[0]! > b[0]! ? -1 : a[0]! < b[0]! ? 1 : a[1]! > b[1]! ? -1 : a[1]! < b[1]! ? 1 : 0
    })
    return { name, latest: versions[0]!, versions }
  })
}
