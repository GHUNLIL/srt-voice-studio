const neuralButton=document.getElementById('neuralDownload');
const neuralVoice=document.getElementById('neuralVoice');
let neuralManifest, neuralWorker, installingVoice=false;
async function neuralFiles(language) {
  neuralManifest ||= fetch('/engine/neural-models-v2.json',{signal:AbortSignal.timeout(20000)}).then(r=>{
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
    const partial=await caches.open('srt-neural-parts-v1');
    const saved=new Set((await partial.keys()).map(request=>new URL(request.url).pathname));
    let remaining=0, needsInstall=false, hasParts=false;
    for(const file of files) {
      if(await cache.match(file.url)) continue;
      needsInstall=true;
      for(const part of file.parts) {
        if(saved.has(partUrl(part))) hasParts=true;
        else remaining+=part.size;
      }
    }
    if(language!==neuralVoice.value || installingVoice) return;
    neuralButton.disabled=!needsInstall;
    const action=hasParts?'继续下载音色':'下载并缓存音色';
    neuralButton.textContent=needsInstall?action+'（剩余 '+Math.ceil(remaining/1e6)+' MB）':'音色已缓存';
  } catch(e) {neuralButton.disabled=false;neuralButton.textContent='重试下载音色';notice(e.message);}
}
const partUrl = part => '/engine/parts/'+part.hash+'.bin';
async function hashBytes(bytes) {
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
async function downloadPart(part,onProgress) {
  const controller=new AbortController();
  let timer;
  const heartbeat=()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>controller.abort(),25000);
  };
  try {
    heartbeat();
    const response=await fetch(partUrl(part),{signal:controller.signal,redirect:'error'});
    if(!response.ok) throw new Error('HTTP '+response.status);
    const reader=response.body.getReader();
    const bytes=new Uint8Array(part.size);
    let offset=0;
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      heartbeat();
      bytes.set(value,offset);
      offset+=value.length;
      onProgress(offset);
    }
    if(offset!==part.size || await hashBytes(bytes)!==part.hash) throw new Error('文件校验失败');
    return new Blob([bytes]);
  } finally {clearTimeout(timer);controller.abort();}
}
async function fetchWithRetry(part,report) {
  for(let attempt=1;;attempt++) {
    try {return await downloadPart(part,loaded=>report(loaded,attempt));}
    catch(error) {
      if(attempt>=3) throw error;
      report(0,attempt+1);
      await new Promise(resolve=>setTimeout(resolve,attempt*700));
    }
  }
}
neuralButton.onclick=async()=>{
  if(installingVoice) return;
  installingVoice=true;
  neuralButton.disabled=true;
  neuralVoice.disabled=true;
  notice('');
  neuralButton.textContent='正在检查下载进度…';
  try {
    const cache=await caches.open('srt-neural-v1');
    const partial=await caches.open('srt-neural-parts-v1');
    const files=Object.values(await neuralFiles(neuralVoice.value));
    const total=files.reduce((sum,file)=>sum+file.size,0);
    let completed=0;
    const report=(loaded,attempt=1)=>{
      neuralButton.textContent=(attempt>1?'正在重试':'正在下载')+' · '+((completed+loaded)/1e6).toFixed(1)+' / '+(total/1e6).toFixed(1)+' MB';
    };
    for(const file of files) {
      if(await cache.match(file.url)) {completed+=file.size;continue;}
      const blobs=[];
      for(const part of file.parts) {
        report(0);
        const key=partUrl(part);
        const cached=await partial.match(key);
        let blob;
        if(cached) blob=await cached.blob();
        else {
          blob=await fetchWithRetry(part,report);
          await partial.put(key,new Response(blob));
        }
        blobs.push(blob);
        completed+=part.size;
        report(0);
      }
      neuralButton.textContent='正在校验并保存 · '+(completed/1e6).toFixed(1)+' MB';
      const fileBlob=new Blob(blobs);
      if(await hashBytes(await fileBlob.arrayBuffer())!==file.hash) {
        for(const part of file.parts) await partial.delete(partUrl(part));
        throw new Error('音色校验失败');
      }
      await cache.put(file.url,new Response(fileBlob));
      for(const part of file.parts) await partial.delete(partUrl(part));
    }
  } catch(e) {
    notice(e.name==='QuotaExceededError'?'浏览器存储空间不足，请释放空间后继续下载。':'下载中断，可点击继续下载。'+e.message);
  } finally {installingVoice=false;neuralVoice.disabled=false;await showNeuralCache();}
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

const previewLines = {
  ja:'朝の駅に、まもなく最初の電車が到着します。',
  ko:'해가 뜨자 조용하던 시장이 조금씩 활기를 되찾습니다.',
  'en-us':'The morning train rolls past the lake as the sun comes up.',
  de:'Am frühen Morgen öffnet die kleine Bäckerei am Marktplatz.',
  cmn:'天刚亮，街角的面包店已经飘出了香味。'
};
function currentExample() {
  return {name:neuralVoice.selectedOptions[0].textContent,text:previewLines[neuralVoice.value]};
}
function updateVoice() {
  byId('sampleText').textContent=currentExample().text;
  showNeuralCache();
}
neuralVoice.addEventListener('change',updateVoice);
updateVoice();
