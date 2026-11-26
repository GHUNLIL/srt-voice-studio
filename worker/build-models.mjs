import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const root = new URL('../',import.meta.url);
const catalog = JSON.parse(await readFile(new URL('engine/neural-models-v1.json',root)));
const dest = new URL('public/engine/parts/',root);
await mkdir(dest,{recursive:true});
const digest = data => createHash('sha256').update(data).digest('hex');
const fileCache = process.env.SRT_MODEL_CACHE;
const files = [...Object.values(catalog.shared),...Object.values(catalog.voices).flatMap(Object.values)];
for (const file of files) {
  let bytes;
  if(fileCache) {
    try { bytes = await readFile(join(fileCache,file.hash)); }
    catch(e) { if(e.code!=='ENOENT') throw e; }
  }
  if(!bytes) {
    const response=await fetch(file.url,{signal:AbortSignal.timeout(300000)});
    if(!response.ok) throw new Error('Model download failed: '+response.status+' '+file.url);
    bytes=Buffer.from(await response.arrayBuffer());
  }
  if(bytes.length!==file.size || digest(bytes)!==file.hash) throw new Error('Invalid model file: '+file.url);
  if(fileCache) {
    await mkdir(fileCache,{recursive:true});
    await writeFile(join(fileCache,file.hash),bytes);
  }
  file.parts=[];
  const partSize=2*1024*1024;
  for(let offset=0;offset<bytes.length;offset+=partSize){
    const part=bytes.subarray(offset,offset+partSize);
    const hash=digest(part);
    await writeFile(new URL(hash+'.bin',dest),part);
    file.parts.push({hash,size:part.length});
  }
}
await writeFile(new URL('public/engine/neural-models-v2.json',root),JSON.stringify(catalog));
