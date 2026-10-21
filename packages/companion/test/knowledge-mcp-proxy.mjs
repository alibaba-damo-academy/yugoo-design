/** Test-only transparent MCP proxy: record tool names, never arguments/results. */
import {spawn} from 'node:child_process'
import {appendFileSync} from 'node:fs'
const [entry,audit]=process.argv.slice(2)
if(!entry||!audit)throw new Error('Expected CLI entry and isolated audit path')
const child=spawn(process.execPath,[entry,'mcp'],{stdio:['pipe','pipe','pipe']})
let pending=''
process.stdin.on('data',bytes=>{
  pending+=bytes.toString()
  let end
  while((end=pending.indexOf('\n'))>=0){
    const line=pending.slice(0,end);pending=pending.slice(end+1)
    try{const event=JSON.parse(line);if(event.method==='tools/call')appendFileSync(audit,JSON.stringify({tool:event.params?.name})+'\n',{mode:0o600})}catch{}
  }
})
process.stdin.pipe(child.stdin);child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr)
child.on('error',()=>{process.exitCode=1;process.stdin.destroy()})
child.on('exit',code=>{process.exitCode=code??1;process.stdin.destroy()})
