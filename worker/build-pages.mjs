import './build.mjs';
import { readFile,writeFile } from 'node:fs/promises';

const handler = await readFile(new URL('./sub2api.mjs',import.meta.url),'utf8');
const entry = await readFile(new URL('./pages.mjs',import.meta.url),'utf8');
await writeFile(new URL('../public/_worker.js',import.meta.url),
  entry.replace("import {sub2Speech} from './sub2api.mjs';",handler.replace('export async function','async function')));
await writeFile(new URL('../public/_routes.json',import.meta.url),
  JSON.stringify({version:1,include:['/api/sub2api/speech'],exclude:[]}));
