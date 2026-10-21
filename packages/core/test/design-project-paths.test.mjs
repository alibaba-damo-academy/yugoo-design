import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultDesignProjectsRoot } from '../src/design-project-paths.ts'

const linux = text => defaultDesignProjectsRoot({ platform: 'linux', home: '/home/test', env: {}, readConfig: () => text })

test('Windows follows Known Folder redirects and UNC rather than guessing from home/OneDrive', () => {
  for (const documents of ['D:\\OneDrive - Team\\文档', '\\\\server\\users\\test\\Documents']) {
    assert.equal(defaultDesignProjectsRoot({ platform: 'win32', home: 'C:\\Users\\test', env: { OneDrive: 'C:\\wrong' }, windowsDocuments: () => documents }), documents + '\\YuGoo\\Projects')
  }
  for (const documents of ['', 'relative', '\\drive-relative', 'C:\\Documents\nextra', 'C:\\Docs\tinvalid']) {
    assert.throws(() => defaultDesignProjectsRoot({ platform: 'win32', windowsDocuments: () => documents }), /Cannot resolve Windows Documents/)
  }
  assert.throws(() => defaultDesignProjectsRoot({ platform: 'win32', windowsDocuments: () => { throw new Error('probe failed') } }), /Configure projectsRoot/)
})

test('Linux follows localized XDG, HOME substitution, whitespace and literal escapes', () => {
  assert.equal(linux('XDG_DOCUMENTS_DIR="$HOME/我的文档"'), '/home/test/我的文档/YuGoo/Projects')
  assert.equal(linux(' XDG_DOCUMENTS_DIR="${HOME}/My Documents" # localized'), '/home/test/My Documents/YuGoo/Projects')
  assert.equal(linux('XDG_DOCUMENTS_DIR="/data/Docs"'), '/data/Docs/YuGoo/Projects')
  assert.equal(linux('XDG_DOCUMENTS_DIR="$HOME/\\$literal"'), '/home/test/$literal/YuGoo/Projects')
  let config
  defaultDesignProjectsRoot({ platform: 'linux', home: '/home/test', env: { XDG_CONFIG_HOME: '/config root' }, readConfig: path => { config = path; return '' } })
  assert.equal(config, '/config root/user-dirs.dirs')
  defaultDesignProjectsRoot({ platform: 'linux', home: '/home/test', env: { XDG_CONFIG_HOME: 'relative' }, readConfig: path => { config = path; return '' } })
  assert.equal(config, '/home/test/.config/user-dirs.dirs')
})

test('missing/disabled/invalid XDG uses documented fallback; shell text never executes', () => {
  for (const text of ['', '# no mapping', 'XDG_DOCUMENTS_DIR="$HOME"', 'XDG_DOCUMENTS_DIR="${HOME}/"',
    'XDG_DOCUMENTS_DIR="relative"', 'XDG_DOCUMENTS_DIR="$OTHER/docs"',
    'XDG_DOCUMENTS_DIR="$(touch /tmp/should-not-run)"', 'XDG_DOCUMENTS_DIR="`pwd`"',
    'XDG_DOCUMENTS_DIR="/one"\nXDG_DOCUMENTS_DIR="/two"', 'XDG_DOCUMENTS_DIR=/unquoted']) {
    assert.equal(linux(text), '/home/test/Documents/YuGoo/Projects', text)
  }
  assert.equal(defaultDesignProjectsRoot({ platform: 'linux', home: '/home/test', env: {}, readConfig: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } }), '/home/test/Documents/YuGoo/Projects')
  assert.throws(() => defaultDesignProjectsRoot({ platform: 'linux', home: '/home/test', env: {}, readConfig: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) } }), /permission denied/)
})

test('macOS and other platforms use Documents without consulting Windows or XDG', () => {
  for (const platform of ['darwin', 'freebsd']) assert.equal(defaultDesignProjectsRoot({ platform, home: '/Users/Test User', windowsDocuments: () => assert.fail(), readConfig: () => assert.fail() }), '/Users/Test User/Documents/YuGoo/Projects')
})
