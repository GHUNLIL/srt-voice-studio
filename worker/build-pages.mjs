import './build.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const files=['sub2api','speech','accounts','pay','pages'];
const sources=await Promise.all(files.map(name=>readFile(new URL('./'+name+'.mjs',import.meta.url),'utf8')));
const bundle=sources.map((s,i)=>s.replace(/^import .*;$/gm,'').replace(/^export \{.*;$/gm,'').replace(/^export (?=async function)/gm,'')).join('\n');
await writeFile(new URL('../public/_worker.js',import.meta.url),bundle
  .replace('__ADMIN_VERIFIER__',process.env.ADMIN_VERIFIER || '__ADMIN_VERIFIER__')
  .replace('__PAY_WRAPPING_KEY__',process.env.PAY_WRAPPING_KEY || '__PAY_WRAPPING_KEY__'));
await writeFile(new URL('../public/_routes.json',import.meta.url),JSON.stringify({version:1,include:['/*'],exclude:[]}));
