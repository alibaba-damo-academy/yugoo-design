import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const root=process.env.FUNCTION_TEST_OUT
if(!root)throw new Error('FUNCTION_TEST_OUT required')
const html='<!doctype html><html lang="zh"><meta charset="utf-8"><title>功能详情隔离测试</title><style>body{margin:0;font-family:system-ui,sans-serif}button{margin-left:12px}</style><div id="root"></div><script type="module" src="/fixture.js"></script><script type="module">import "/fixture.js"; const s=document.createElement("script");s.src="/provider.js";document.body.append(s)</script></html>'
const server=createServer(async(req,res)=>{
  try{
    const route=new URL(req.url,'http://127.0.0.1').pathname
    if(route==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return}
    const path=route==='/fixture.js'?join(root,'fixture.js'):route==='/provider.js'?new URL('../lib/client.js',import.meta.url).pathname:undefined
    if(!path){res.writeHead(404);res.end();return}
    res.setHeader('Content-Type','text/javascript');res.end(await readFile(path))
  }catch{res.writeHead(500);res.end('Fixture asset unavailable')}
})
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`))
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit()))
