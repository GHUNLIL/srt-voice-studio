import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
const dest = new URL('../public/', import.meta.url);
await mkdir(dest, {recursive: true});
for (const generated of ['_worker.js','_routes.json']) await rm(new URL(generated,dest),{force:true});
const root = file => new URL('../' + file,import.meta.url);
let page = await readFile(root('index.html'),'utf8');
const styles = await readFile(root('studio.css'),'utf8');
page = page.replace('<link rel="stylesheet" href="./studio.css">', () => '<style>'+styles+'</style>');
for (const file of ['studio.js','cloud-speech.js']) {
  const script = await readFile(root(file),'utf8');
  page = page.replace('<script src="./'+file+'"></script>', () => '<script>'+script+'</script>');
}
await writeFile(new URL('index.html',dest), page);
await rm(new URL('cloud-speech.js',dest),{force:true});
await rm(new URL('engine/',dest),{recursive:true,force:true});
await cp(root('engine'),new URL('engine/',dest),{recursive:true});
await copyFile(root('speech-config.json'),new URL('speech-config.json',dest));
