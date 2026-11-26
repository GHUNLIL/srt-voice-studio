const neuralButton=document.getElementById('neuralDownload');
const neuralVoice=document.getElementById('neuralVoice');
let neuralManifest, neuralWorker, installingVoice=false;
async function neuralFiles(language) {
  neuralManifest ||= fetch('/engine/neural-models-v1.json').then(r=>{
    if(!r.ok) throw new Error('音色列表暂时不可用。');
    return r.json();
  }).catch(e=>{neuralManifest=null; throw e;});
  const catalog=await neuralManifest;
  const shared=language==='ja'?{ortJS:catalog.shared.ortJS,ortWasm:catalog.shared.ortWasm}:catalog.shared;
  return {...shared,...catalog.voices[language]};
}
async function showNeuralCache() {
  const language=neuralVoice.value;
  try {
    const files=Object.values(await neuralFiles(language));
    const cache=await caches.open('srt-neural-v1');
    let remaining=0;
    for(const file of files) if(!await cache.match(file.url)) remaining+=file.size;
    if(language!==neuralVoice.value || installingVoice) return;
    neuralButton.disabled=!remaining;
    neuralButton.textContent=remaining?'下载并缓存音色（'+Math.ceil(remaining/1e6)+' MB）':'音色已缓存';
  } catch(e) {neuralButton.disabled=false;neuralButton.textContent='重试下载音色';notice(e.message);}
}
neuralButton.onclick=async()=>{
  if(installingVoice) return;
  installingVoice=true;
  neuralButton.disabled=true;
  neuralVoice.disabled=true;
  notice('');
  try {
    const cache=await caches.open('srt-neural-v1');
    const files=Object.values(await neuralFiles(neuralVoice.value));
    for(const [i,file] of files.entries()) {
      if(await cache.match(file.url)) continue;
      neuralButton.textContent='正在下载 '+(i+1)+' / '+files.length+' · '+Math.ceil(file.size/1e6)+' MB';
      const response=await fetch(file.url,{credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok) throw new Error('音色下载失败，请重试。');
      const reader=response.body.getReader();
      const bytes=new Uint8Array(file.size);
      let loaded=0;
      while(true) {
        const {done,value}=await reader.read();
        if(done) break;
        bytes.set(value,loaded);
        loaded+=value.byteLength;
        neuralButton.textContent='下载 '+(i+1)+' / '+files.length+' · '+Math.floor(100*loaded/file.size)+'%';
      }
      if(loaded!==file.size) throw new Error('下载不完整。');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      if(bytes.byteLength!==file.size || hash!==file.hash) throw new Error('文件校验失败，请重试。');
      await cache.put(file.url,new Response(bytes));
    }
  } catch(e) {notice('下载未完成，已缓存的文件可复用。'+e.message);}
  finally {installingVoice=false;neuralVoice.disabled=false;await showNeuralCache();}
};
async function neuralSpeech(text,settings,signal) {
  const catalog=await neuralFiles(settings.neuralVoice);
  signal.throwIfAborted();
  const files=Object.fromEntries(Object.entries(catalog).map(([name,file])=>[name,file.url]));
  neuralWorker ||= new Worker('/engine/neural-worker-v1.js');
  return new Promise((resolve,reject)=>{
    const reset=()=>{neuralWorker?.terminate();neuralWorker=null;};
    const abort=()=>{reset();reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    neuralWorker.onerror=e=>{signal.removeEventListener('abort',abort);reset();reject(new Error(e.message || '浏览器无法启动神经引擎。'));};
    neuralWorker.onmessage=({data})=>{
      signal.removeEventListener('abort',abort);
      if(data.error) {reset();reject(new Error(data.error));return;}
      resolve(data.rate===SAMPLE_RATE?data.samples:resample(data.samples,data.rate/SAMPLE_RATE));
    };
    neuralWorker.postMessage({text,voice:settings.neuralVoice,files,rate:settings.rate});
  });
}
