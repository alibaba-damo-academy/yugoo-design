// Node-only loader for this package's own source-built local-Git artifacts.
'use strict'
const { join } = require('node:path')
const target = `${process.platform}-${process.arch}`
const supported = new Set(['linux-x64', 'win32-x64', 'darwin-arm64'])
if (!supported.has(target)) throw new Error(`Yugoo Design native Git: unsupported platform ${target}`)
if (target === 'linux-x64' && !process.report.getReport().header.glibcVersionRuntime) {
  throw new Error('Yugoo Design native Git: Linux musl is not supported by this build')
}
const nativeBinding = require(join(__dirname, 'native', `yugoo_git.${target}.node`))
module.exports = nativeBinding
module.exports.Blob = nativeBinding.Blob
module.exports.Branch = nativeBinding.Branch
module.exports.Commit = nativeBinding.Commit
module.exports.Config = nativeBinding.Config
module.exports.Cred = nativeBinding.Cred
module.exports.Deltas = nativeBinding.Deltas
module.exports.Diff = nativeBinding.Diff
module.exports.DiffDelta = nativeBinding.DiffDelta
module.exports.DiffFile = nativeBinding.DiffFile
module.exports.FetchOptions = nativeBinding.FetchOptions
module.exports.GitObject = nativeBinding.GitObject
module.exports.Index = nativeBinding.Index
module.exports.ProxyOptions = nativeBinding.ProxyOptions
module.exports.PushOptions = nativeBinding.PushOptions
module.exports.Reference = nativeBinding.Reference
module.exports.Remote = nativeBinding.Remote
module.exports.RemoteCallbacks = nativeBinding.RemoteCallbacks
module.exports.RepoBuilder = nativeBinding.RepoBuilder
module.exports.Repository = nativeBinding.Repository
module.exports.RevWalk = nativeBinding.RevWalk
module.exports.Signature = nativeBinding.Signature
module.exports.Tag = nativeBinding.Tag
module.exports.Tree = nativeBinding.Tree
module.exports.TreeBuilder = nativeBinding.TreeBuilder
module.exports.TreeEntry = nativeBinding.TreeEntry
module.exports.TreeIter = nativeBinding.TreeIter
module.exports.AutotagOption = nativeBinding.AutotagOption
module.exports.BranchType = nativeBinding.BranchType
module.exports.CloneLocal = nativeBinding.CloneLocal
module.exports.ConfigLevel = nativeBinding.ConfigLevel
module.exports.CredentialType = nativeBinding.CredentialType
module.exports.credTypeContains = nativeBinding.credTypeContains
module.exports.Delta = nativeBinding.Delta
module.exports.diffBuffers = nativeBinding.diffBuffers
module.exports.DiffFlags = nativeBinding.DiffFlags
module.exports.diffFlagsContains = nativeBinding.diffFlagsContains
module.exports.Direction = nativeBinding.Direction
module.exports.FetchPrune = nativeBinding.FetchPrune
module.exports.FileMode = nativeBinding.FileMode
module.exports.GitErrorCode = nativeBinding.GitErrorCode
module.exports.isGitError = nativeBinding.isGitError
module.exports.ObjectType = nativeBinding.ObjectType
module.exports.ReferenceType = nativeBinding.ReferenceType
module.exports.RemoteRedirect = nativeBinding.RemoteRedirect
module.exports.RemoteUpdateFlags = nativeBinding.RemoteUpdateFlags
module.exports.RepositoryOpenFlags = nativeBinding.RepositoryOpenFlags
module.exports.RepositoryState = nativeBinding.RepositoryState
module.exports.Sort = nativeBinding.Sort
