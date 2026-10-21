// Shared flex-layout fixture; source geometry, not installed-host acceptance.
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
const baselineIndex=process.argv.indexOf('--baseline')
const baselineRevision=baselineIndex<0?undefined:process.argv[baselineIndex+1]
if(baselineIndex>=0&&!/^[a-f0-9]{7,40}$/.test(baselineRevision??''))throw Error('Use --baseline COMMIT to compare an explicit pre-fix revision')
const css=baselineRevision
  ? execFileSync('git',['show',baselineRevision+':packages/panel/src/visual-components.css'],{cwd:new URL('../../../',import.meta.url),encoding:'utf8'})
  : await readFile(new URL('../src/visual-components.css',import.meta.url),'utf8')
const markdown=renderToStaticMarkup(React.createElement(ReactMarkdown,null,Array.from({length:30},(_,i)=>`## Observation ${i+1}\n\nSynthetic long-form text for testing layout only. No user facts.\n\n- Evidence remains separate from links.\n- Hidden facts are not rewritten.`).join('\n\n')))
const source='<section><h3>Sources</h3><a href="https://example.org/synthetic-layout-evidence">https://example.org/synthetic-layout-evidence</a></section>'
const html=`<!doctype html><meta charset="utf-8"><title>Shared artifact content regression</title><style>${css}\nbody{font:14px system-ui;margin:16px}.probe{height:500px;border:1px solid #ddd;display:flex;flex-direction:column;margin-bottom:24px}.dsh-artifact-content{box-sizing:border-box}</style><h1>Shared artifact layout regression</h1>${[320,960].map(width=>`<div class="probe" data-width="${width}" data-kind="markdown" style="width:${width}px;max-width:100%"><div class="dsh-artifact-content"><div class="dsh-artifact-preview"><div class="dsh-artifact-preview-toolbar"><button>Refresh</button></div><div class="dsh-artifact-markdown">${markdown}</div></div>${source}</div></div>`).join('')}<div class="probe" data-kind="html" style="width:960px;max-width:100%"><div class="dsh-artifact-content"><div class="dsh-artifact-preview is-document"><div class="dsh-artifact-preview-toolbar"><button>Refresh</button></div><iframe title="Synthetic HTML" sandbox srcdoc="&lt;h1&gt;Synthetic HTML document&lt;/h1&gt;"></iframe></div>${source}</div></div>`
const server=createServer((req,res)=>{if(req.url!=='/'){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html)})
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,origin:`http://127.0.0.1:${server.address().port}`})))
process.once('SIGTERM',()=>server.close(()=>{console.log('terminal');process.exit(0)}))
