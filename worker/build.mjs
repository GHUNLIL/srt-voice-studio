import { copyFile, mkdir } from 'node:fs/promises';
const dest = new URL('../public/', import.meta.url);
await mkdir(dest, {recursive: true});
for (const file of ['index.html', 'cloud-speech.js', 'speech-config.json']) {
  await copyFile(new URL('../' + file, import.meta.url), new URL(file, dest));
}
