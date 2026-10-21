/** Read-only experiment helper. The caller selects the Kit whose existing schemas apply. */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSchemaYaml } from '../src/schema.ts'
import { projectDesignGraph } from '../src/design-graph.ts'

export async function projectGraphFixture(root, kitRoot) {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  const checkpoint = git(['rev-parse', 'HEAD']).trim(), files = {}, schemas = {}
  for (const path of git(['ls-tree', '-r', '--name-only', checkpoint, '--', 'design_files']).trim().split('\n')) {
    const rel = path.replace(/^design_files\//, ''), parts = rel.split('/')
    if (parts.length !== 2 || parts[0].startsWith('_') || parts[1] !== `${parts[0]}.json`) continue
    files[rel] = JSON.parse(git(['show', `${checkpoint}:${path}`]))
    if (kitRoot) {
      try { schemas[rel] = parseSchemaYaml(await readFile(join(kitRoot, 'skills', parts[0], 'schema.yaml'), 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  return projectDesignGraph(files, checkpoint, schemas)
}
