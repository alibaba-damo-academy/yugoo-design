import { readFile, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { validateIndex, validateScene } from './scene.mjs'

try {
  if (process.argv.length !== 3) throw new Error('Usage: node validate.mjs DESIGN_FILES_ROOT')
  const root = await realpath(resolve(process.argv[2]))
  const read = async path => {
    const full = await realpath(resolve(root, path))
    const rel = relative(root, full)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Artifact escapes Design Files')
    return readFile(full)
  }
  const state = validateIndex(JSON.parse(await read('whiteboard/whiteboard.json')))
  for (const id of state.board_order) {
    const scene = validateScene(JSON.parse(await read(state.boards[id].artifact_file)))
    for (const file of Object.values(scene.files)) if (!(await read(file.path)).length) throw new Error(`Empty image: ${file.path}`)
  }
  console.log(JSON.stringify({ valid: true, boards: state.board_order.length }))
} catch (error) {
  console.log(JSON.stringify({ valid: false, error: error.message }))
  process.exitCode = 1
}
