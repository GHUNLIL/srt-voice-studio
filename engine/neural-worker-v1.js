// All binaries are read from the cache filled by the user's download action.
let session, modelConfig, phonemizer, activeVoice;
async function cached(key) {
  const response = await (await caches.open('srt-neural-v1')).match(key);
  if (!response) throw new Error('请先下载当前音色。');
  return response;
}
async function loadVoice(voice, files) {
  if (activeVoice === voice) return;
  if (!self.ort) {
    const url=URL.createObjectURL(new Blob([await (await cached(files.ortJS)).arrayBuffer()],{type:'text/javascript'}));
    try { importScripts(url); } finally { URL.revokeObjectURL(url); }
    ort.env.wasm.numThreads = 1;
    const wasmUrl = URL.createObjectURL(new Blob([await (await cached(files.ortWasm)).arrayBuffer()],{type:'application/wasm'}));
    ort.env.wasm.wasmPaths = {'ort-wasm-simd.wasm':wasmUrl,'ort-wasm-simd-threaded.wasm':wasmUrl};
  }
  modelConfig = await (await cached(files.cfg)).json();
  if (voice === 'ja') {
    const moduleUrl=URL.createObjectURL(new Blob([await (await cached(files.jaJS)).arrayBuffer()],{type:'text/javascript'}));
    try {
      const mod=await import(moduleUrl);
      mod.initSync({module:await (await cached(files.jaWasm)).arrayBuffer()});
      const japanese=new mod.WasmPhonemizer(JSON.stringify(modelConfig));
      phonemizer=text=>{
        const result=japanese.phonemize(text,'ja');
        try {return {ids:result.phonemeIds,prosody:result.prosodyFeatures};}
        finally {result.free();}
      };
    } finally {URL.revokeObjectURL(moduleUrl);}
  } else {
    if (!self.createPiperPhonemize) {
      const url=URL.createObjectURL(new Blob([await (await cached(files.phoneJS)).arrayBuffer()],{type:'text/javascript'}));
      try { importScripts(url); } finally { URL.revokeObjectURL(url); }
    }
    const data = await (await cached(files.phoneData)).arrayBuffer();
    let phonemes;
    const mod = await createPiperPhonemize({
      wasmBinary:await (await cached(files.phoneWasm)).arrayBuffer(),
      getPreloadedPackage:()=>data,
      print:line=>{ const parsed=JSON.parse(line); phonemes.push(...parsed.phoneme_ids); },
      printErr:()=>{}
    });
    phonemizer = text => {
      phonemes=[];
      mod.callMain(['-l',modelConfig.espeak.voice,'--input',JSON.stringify([{text}]),'--espeak_data','/espeak-ng-data']);
      return {ids:phonemes};
    };
  }
  if (session) await session.release();
  session = await ort.InferenceSession.create(await (await cached(files.model)).arrayBuffer(),{executionProviders:['wasm']});
  activeVoice = voice;
}
self.onmessage = async ({data}) => {
  try {
    await loadVoice(data.voice,data.files);
    const {ids,prosody}=phonemizer(data.text);
    if(!ids.length) throw new Error('当前音色无法朗读这段文字。');
    const options=modelConfig.inference;
    const inputs={
      input:new ort.Tensor('int64',BigInt64Array.from(ids,BigInt),[1,ids.length]),
      input_lengths:new ort.Tensor('int64',BigInt64Array.of(BigInt(ids.length)),[1]),
      scales:new ort.Tensor('float32',Float32Array.of(options.noise_scale,options.length_scale/(1+data.rate/100),options.noise_w),[3])
    };
    if(session.inputNames.includes('lid')) inputs.lid=new ort.Tensor('int64',BigInt64Array.of(0n),[1]);
    if(session.inputNames.includes('prosody_features')) inputs.prosody_features=new ort.Tensor('int64',BigInt64Array.from(prosody,BigInt),[1,ids.length,3]);
    if(data.voice==='ja') {
      // The pinned CSS10 graph requires both optional speaker inputs, even for its standard voice.
      inputs.speaker_embedding=new ort.Tensor('float32',new Float32Array(256),[1,256]);
      inputs.speaker_embedding_mask=new ort.Tensor('int64',BigInt64Array.of(0n),[1,1]);
    }
    const outputs=await session.run(inputs);
    const output=outputs[session.outputNames[0]];
    const samples=Int16Array.from(output.data,x=>Math.round(Math.max(-1,Math.min(1,x))*32767));
    self.postMessage({samples,rate:modelConfig.audio.sample_rate},[samples.buffer]);
  } catch(e) { self.postMessage({error:e.message || String(e)}); }
};
