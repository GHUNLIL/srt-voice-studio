import './build.mjs';
import { readFile,writeFile } from 'node:fs/promises';

const source = file => readFile(new URL(file,import.meta.url),'utf8');
const digest = process.env.SITE_LOGIN_SHA256;
if (digest && !/^[0-9a-f]{64}$/.test(digest)) throw new Error('Invalid SITE_LOGIN_SHA256');
const access = (await source('./site-access.mjs')).replace('__SITE_LOGIN_SHA256__',digest || '__SITE_LOGIN_SHA256__');
const handler = await source('./sub2api.mjs');
const entry = (await source('./pages.mjs')).replace(/^import .*;$/gm,'');
await writeFile(new URL('../public/_worker.js',import.meta.url),
  [access,handler].map(text => text.replace(/^export /gm,'')).concat(entry).join('\n'));
await writeFile(new URL('../public/_routes.json',import.meta.url),
  JSON.stringify({version:1,include:['/*'],exclude:[]}));
