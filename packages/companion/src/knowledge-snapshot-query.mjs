/** Read-only CLI for a service-owned immutable KAG replica. No database access. */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { queryKnowledgeSnapshot, knowledgeQueryFilters, knowledgeReadResult } from '../../core/lib/index.js'

export function queryReviewSnapshot(snapshot, args) {
  if (!snapshot || snapshot.project !== args.project || snapshot.checkpoint !== args.checkpoint || snapshot.graph?.revision !== args.revision) {
    throw new Error('Review snapshot requires matching project/checkpoint/revision pins')
  }
  const filters = knowledgeQueryFilters(args)
  return knowledgeReadResult(snapshot.project, snapshot.checkpoint,
    queryKnowledgeSnapshot(snapshot.graph, {...filters, projectId:snapshot.project, revision:args.revision, offset:args.offset??0, limit:args.limit??30}))
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node knowledge-snapshot-query.mjs SNAPSHOT_FILE QUERY_JSON')
    const bytes = await readFile(process.argv[2])
    if (bytes.length > 64*1024*1024) throw new Error('Review snapshot exceeds size budget')
    process.stdout.write(JSON.stringify(queryReviewSnapshot(JSON.parse(bytes), JSON.parse(process.argv[3])))+'\n')
  } catch (error) { console.error(error.message); process.exitCode=1 }
}
