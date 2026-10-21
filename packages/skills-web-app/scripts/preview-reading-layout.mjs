// Isolated, read-only preview. Generated BPMN remains in process memory.
import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=fileURLToPath(new URL('.',import.meta.url));
const examples=fileURLToPath(new URL('../../../examples/research-platform-comparison/good/design_files/flow_design/',import.meta.url));
const names=readdirSync(examples).filter(n=>/^P-00\d\.bpmn$/.test(n)).sort();
const cache=new Map();
let queue=Promise.resolve();
const profiles=['baseline','alignment','balanced','routing','balanced-channels'];
function run(input,profile) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[`${here}../bundles/flow_design/scripts/layout.mjs`],{env:{...process.env,
      BPMN_LAYOUT_READING:profile==='baseline'?'0':'1',BPMN_LAYOUT_PREFERENCE:profile==='balanced-channels'?'balanced':profile==='baseline'?'alignment':profile,
      BPMN_LAYOUT_CHANNELS:profile==='balanced-channels'?'1':'0',
      BPMN_LAYOUT_READING_REPORT:'1',BPMN_LAYOUT_EXPERIMENT_BUDGET:'1'}});
    let xml='',stderr='';const start=Date.now();
    const timer=setTimeout(()=>child.kill('SIGTERM'),60000);
    child.stdout.on('data',v=>xml+=v);child.stderr.on('data',v=>stderr+=v);
    child.on('error',reject);
    child.on('close',code=>{
      clearTimeout(timer);
      if(code!==0)return reject(new Error(`Layout ${profile} failed: ${stderr.slice(-2000)}`));
      try{resolve({profile,xml,ms:Date.now()-start,metrics:JSON.parse(stderr.match(/reading-metrics (\{[^\n]+\})/)[1])});}catch(e){reject(e);}
    });
    child.stdin.end(input);
  });
}
function prepare(name) {
  if(cache.has(name))return cache.get(name);
  const entry={status:'queued',variants:[]};cache.set(name,entry);
  queue=queue.then(async()=>{
    entry.status='running';
    try {
      const input=readFileSync(`${examples}/${name}`,'utf8');
      for(const profile of profiles){entry.current=profile;entry.variants.push(await run(input,profile));}
      entry.status='ready';delete entry.current;console.log(`Preview ready: ${name}`);
    }catch(e){entry.status='failed';entry.error=e.message;}
  });
  return entry;
}
const assets={
  '/':{path:`${here}reading-layout-preview.html`,type:'text/html; charset=utf-8'},
  '/viewer.js':{path:`${here}../node_modules/bpmn-js/dist/bpmn-navigated-viewer.production.min.js`,type:'text/javascript'},
  '/diagram.css':{path:`${here}../node_modules/bpmn-js/dist/assets/diagram-js.css`,type:'text/css'},
};
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(path==='/api/cases'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(names));}
  if(path.startsWith('/api/layout/')) {
    const name=decodeURIComponent(path.slice('/api/layout/'.length));
    if(!names.includes(name)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(prepare(name)));
  }
  const asset=assets[path];if(!asset){res.writeHead(404);return res.end();}
  try{res.setHeader('Content-Type',asset.type);res.end(readFileSync(asset.path));}catch(e){res.writeHead(500);res.end(e.message);}
});
server.listen(Number(process.env.FLOW_PREVIEW_PORT||18874),'127.0.0.1',()=>{
  console.log(`Flow comparison preview: http://127.0.0.1:${server.address().port}`);
  prepare('P-001.bpmn');
});
