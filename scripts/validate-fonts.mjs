import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const TAGS = ['cmap','head','hhea','hmtx','maxp','name','OS/2','post','cvt ','fpgm','glyf','loca','prep','CFF ','VORG','EBDT','EBLC','gasp','hdmx','kern','LTSH','PCLT','VDMX','vhea','vmtx','BASE','GDEF','GPOS','GSUB','EBSC','JSTF','MATH','CBDT','CBLC','COLR','CPAL','SVG ','sbix','acnt','avar','bdat','bloc','bsln','cvar','fdsc','feat','fmtx','fvar','gvar','hsty','just','lcar','mort','morx','opbd','prop','trak','Zapf','Silf','Glat','Gloc','Feat','Sill'];
const LIMIT=64*1024*1024;
export const sha256 = b => createHash('sha256').update(b).digest('hex');
function requireThat(ok,message){if(!ok)throw new Error(message)}
function range(b,o,n){requireThat(Number.isSafeInteger(o)&&Number.isSafeInteger(n)&&o>=0&&n>=0&&o+n<=b.length,'table bounds');return b.subarray(o,o+n)}
export function readTables(b){
 requireThat(b.length>=48&&b.length<=LIMIT,'WOFF2 size');
 requireThat(b.toString('ascii',0,4)==='wOF2','WOFF2 signature');
 requireThat(b.readUInt32BE(4)!==0x74746366,'font collections unsupported');
 requireThat(b.readUInt32BE(4)===0x10000,'only selected TrueType flavor supported');
 requireThat(b.readUInt32BE(8)===b.length&&b.readUInt16BE(14)===0,'WOFF2 header');
 const count=b.readUInt16BE(12), compressed=b.readUInt32BE(20);requireThat(count>0&&count<=63,'table count');
 let pos=48,total=0,sfntSize=12+count*16;const entries=[],seen=new Set();
 const byte=()=>{requireThat(pos<b.length,'directory truncated');return b[pos++]};
 const base128=()=>{let v=0;for(let i=0;i<5;i++){const n=byte();requireThat(!(i===0&&n===128),'noncanonical Base128');requireThat((v&0xfe000000)===0,'Base128 overflow');v=v*128+(n&127);if(!(n&128))return v}throw new Error('Base128 length')};
 for(let i=0;i<count;i++){
  const flags=byte(),index=flags&63,version=flags>>>6;const tag=index===63?range(b,pos,4).toString('ascii'):TAGS[index];if(index===63)pos+=4;
  requireThat(!seen.has(tag),'duplicate table');seen.add(tag);
  const original=base128(),glyph=tag==='glyf'||tag==='loca';
  requireThat(glyph?(version===0||version===3):(version===0||(tag==='hmtx'&&version===1)),'unsupported table transform');
  const transformed=glyph?version!==3:version!==0,len=transformed?base128():original;
  requireThat(!(tag==='loca'&&transformed)||len===0,'transformed loca length');
  requireThat(original<=LIMIT&&total+len<=LIMIT,'table stream limit');entries.push({tag,offset:total,len,transformed});total+=len;sfntSize+=Math.ceil(original/4)*4;
 }
 requireThat(sfntSize===b.readUInt32BE(16)&&sfntSize<=LIMIT,'original sfnt size');
 const glyf=entries.find(e=>e.tag==='glyf'),loca=entries.find(e=>e.tag==='loca');
 requireThat(glyf&&loca&&glyf.transformed===loca.transformed,'glyf/loca transform pair');
 range(b,pos,compressed);
 let previousEnd=pos+compressed;
 for(const [o,n] of [[b.readUInt32BE(28),b.readUInt32BE(32)],[b.readUInt32BE(40),b.readUInt32BE(44)]]){
  requireThat((o===0)===(n===0),'optional block header');if(o){requireThat(o>=previousEnd,'optional block overlap');range(b,o,n);previousEnd=o+n}
 }
 const data=brotliDecompressSync(range(b,pos,compressed),{maxOutputLength:LIMIT});requireThat(data.length===total,'table stream length');
 const tables=new Map(entries.map(e=>[e.tag,{...e,bytes:range(data,e.offset,e.len)}]));
 return tag=>{const e=tables.get(tag);requireThat(e&&!e.transformed,`missing or transformed ${tag}`);return e.bytes};
}
function cmapPoints(b){
 range(b,0,4);requireThat(b.readUInt16BE(0)===0,'cmap version');const n=b.readUInt16BE(2);range(b,4,n*8);
 const priority=[[3,10],[0,6],[0,4],[3,1],[0,3],[0,2],[0,1],[0,0]];let offset;
 for(const [platform,encoding] of priority){for(let i=0;i<n;i++){const o=4+i*8;if(b.readUInt16BE(o)===platform&&b.readUInt16BE(o+2)===encoding){offset=b.readUInt32BE(o+4);break}}if(offset!==undefined)break}
 requireThat(offset!==undefined,'Unicode cmap missing');range(b,offset,2);const format=b.readUInt16BE(offset),points=new Set();
 if(format===12){
  range(b,offset,16);const length=b.readUInt32BE(offset+4),groups=b.readUInt32BE(offset+12);const t=range(b,offset,length);range(t,16,groups*12);let prev=-1;
  for(let i=0;i<groups;i++){const o=16+i*12,start=t.readUInt32BE(o),end=t.readUInt32BE(o+4),glyph=t.readUInt32BE(o+8);requireThat(start>prev&&end>=start&&end<=0x10ffff,'cmap groups');for(let c=start;c<=end;c++)if(glyph+c-start!==0)points.add(c);prev=end}
 }else if(format===4){
  range(b,offset,14);const t=range(b,offset,b.readUInt16BE(offset+2)),segs=t.readUInt16BE(6)/2;requireThat(Number.isInteger(segs)&&segs>0,'cmap segments');range(t,14,8*segs+2);
  let prev=-1;for(let i=0;i<segs;i++){const end=t.readUInt16BE(14+i*2),start=t.readUInt16BE(16+segs*2+i*2),delta=t.readInt16BE(16+segs*4+i*2),ro=16+segs*6+i*2,r=t.readUInt16BE(ro);requireThat(start<=end&&start>prev,'cmap segment order');for(let c=start;c<=end&&c<65535;c++){let glyph;if(r){range(t,ro+r+(c-start)*2,2);glyph=t.readUInt16BE(ro+r+(c-start)*2);if(glyph)glyph=(glyph+delta)&65535}else glyph=(c+delta)&65535;if(glyph)points.add(c)}prev=end}
 }else throw new Error('unsupported Unicode cmap format');return points;
}
function namesFrom(b){
 range(b,0,6);const n=b.readUInt16BE(2),strings=b.readUInt16BE(4);range(b,6,n*12);const names=[];
 for(let i=0;i<n;i++){const o=6+i*12,platform=b.readUInt16BE(o),id=b.readUInt16BE(o+6);if(![0,1,2,4,5,6,13,14].includes(id)||![0,3].includes(platform))continue;const raw=range(b,strings+b.readUInt16BE(o+10),b.readUInt16BE(o+8));requireThat(raw.length%2===0,'name Unicode length');const value=Buffer.from(raw).swap16().toString('utf16le');if(!names.some(x=>x.id===id&&x.value===value))names.push({id,value})}
 return names;
}
export function inspectFont(bytes){
 const table=readTables(bytes),head=table('head'),hhea=table('hhea');range(head,0,54);range(hhea,0,36);requireThat(head.readUInt32BE(12)===0x5f0f3cf5,'head magic');
 const metrics={unitsPerEm:head.readUInt16BE(18),ascender:hhea.readInt16BE(4),descender:hhea.readInt16BE(6),lineGap:hhea.readInt16BE(8)};
 const points=cmapPoints(table('cmap')),names=namesFrom(table('name')),variableAxes=[];
 // Absence is allowed only when no fvar entry exists; malformed present tables must fail.
 let fvar;try{fvar=table('fvar')}catch(error){if(error.message!=='missing or transformed fvar')throw error}
 if(fvar){range(fvar,0,16);requireThat(fvar.readUInt16BE(0)===1,'fvar version');const offset=fvar.readUInt16BE(4),count=fvar.readUInt16BE(8),size=fvar.readUInt16BE(10);requireThat(size>=20&&count<=32,'fvar axis size');range(fvar,offset,count*size);for(let i=0;i<count;i++){const o=offset+i*size;variableAxes.push({tag:fvar.toString('ascii',o,o+4),min:fvar.readInt32BE(o+4)/65536,default:fvar.readInt32BE(o+8)/65536,max:fvar.readInt32BE(o+12)/65536})}}
 return {metrics,cmapCount:points.size,names,variableAxes,points};
}
export function assertMetadata(actual,expected){
 requireThat(JSON.stringify(actual.metrics)===JSON.stringify(expected.metrics),'metrics mismatch');
 requireThat(JSON.stringify(actual.variableAxes)===JSON.stringify(expected.variableAxes),'axes mismatch');
 requireThat(actual.cmapCount===expected.cmapCount,'cmap count mismatch');
 requireThat(expected.names.length===actual.names.length&&expected.names.every(x=>actual.names.some(y=>x.id===y.id&&x.value===y.value)),'font names mismatch');
 for(const c of expected.requiredCharacters)requireThat(actual.points.has(c.codePointAt(0)),`required character missing U+${c.codePointAt(0).toString(16)}`);
}
function readWithin(root,relative){
 requireThat(typeof relative==='string'&&!path.isAbsolute(relative)&&relative.split(/[\\/]/).every(x=>x&&x!=='.'&&x!=='..'),'input path');
 const canonical=fs.realpathSync(root);let current=canonical;
 for(const component of relative.split('/')){current=path.join(current,component);requireThat(!fs.lstatSync(current).isSymbolicLink(),'symlink input')}
 requireThat(fs.statSync(current).isFile(),'input is not file');const s=fs.statSync(current);requireThat(s.size<=LIMIT,'input file size');return fs.readFileSync(current);
}
export function validateFonts(root,manifestFile=new URL('./whiteboard-fonts/manifest.json',import.meta.url)){
 const raw=fs.readFileSync(manifestFile);requireThat(sha256(raw)===MANIFEST_SHA256,'authority manifest drift');const manifest=JSON.parse(raw);
 return manifest.fonts.map(font=>{
  const binary=readWithin(root,font.file),license=readWithin(root,font.licenseFile);
  requireThat(binary.length===font.bytes&&sha256(binary)===font.sha256,'font binary pin mismatch');requireThat(license.length===font.licenseBytes&&sha256(license)===font.licenseSha256,'license pin mismatch');
  const actual=inspectFont(binary);assertMetadata(actual,font);
  return {role:font.role,sha256:sha256(binary),licenseSha256:sha256(license),metrics:actual.metrics,variableAxes:actual.variableAxes,cmapCount:actual.cmapCount,sourceCommit:font.sourceCommit,exportPolicy:font.exportPolicy};
 });
}
const MANIFEST_SHA256='c164438115a40cdead905085e95298f28a4ffa2a3947512b9a98509f33c26972';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{requireThat(process.argv.length===3,'usage: node validate-fonts.mjs INPUT_ROOT');console.log(JSON.stringify({ok:true,fonts:validateFonts(process.argv[2])},null,2))}catch(error){console.error(error.message);process.exitCode=1}
}
