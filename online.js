const engineSelect=byId('engineSelect');
const onlineVoice=byId('onlineVoice');
const families=[
  {lang:'cmn',locale:'cmn-CN',label:'普通话',polly:['Zhiyu'],original:['zh-CN-Xiaoxiao','zh-CN-Yunxi'],names:['晓晓','云希']},
  {lang:'ja',locale:'ja-JP',label:'日语',polly:['Takumi','Kazuha'],original:['ja-JP-Keita','ja-JP-Nanami'],names:['Keita · 原版「安倍晋三」','Nanami · 原版「高市早苗」']},
  {lang:'ko',locale:'ko-KR',label:'韩语',polly:['Seoyeon','Jihye'],original:['ko-KR-InJoon','ko-KR-SunHi'],names:['InJoon · 原版「李敏镐」','SunHi · 原版「全智贤」']},
  {lang:'en-us',locale:'en-US',label:'英语',polly:['Matthew','Joanna'],original:['en-US-Guy','en-US-Jenny'],names:['Guy · 原版「特朗普」','Jenny · 原版「哈里斯」']},
  {lang:'de',locale:'de-DE',label:'德语',polly:['Daniel','Vicki'],original:['de-DE-Killian','de-DE-Katja'],names:['Killian · 原版「施威格」','Katja · 原版「克鲁格」']}
];
let bridgePort, pollyReady=false;
const pollyOrigin='https://unlil-srt.pages.dev';
const pendingSpeech=new Map();
function mountPolly(){
  if(byId('pollyLogin').firstChild)return;
  const frame=document.createElement('iframe');
  frame.title='Puter 账户连接';
  frame.style='display:block;width:100%;height:46px;border:0;margin-top:8px';
  frame.referrerPolicy='no-referrer';
  frame.onload=()=>{
    pollyReady=false;
    bridgePort?.close();
    const channel=new MessageChannel();
    bridgePort=channel.port1;
    bridgePort.onmessage=({data})=>{
      if(typeof data.ready==='boolean')pollyReady=data.ready;
      else pendingSpeech.get(data.id)?.(data);
    };
    frame.contentWindow.postMessage('connect',pollyOrigin,[channel.port2]);
  };
  frame.src=pollyOrigin+'/polly-bridge';
  byId('pollyLogin').append(frame);
}
function selectedExample(){
  if(engineSelect.value==='local')return currentExample();
  const option=onlineVoice.selectedOptions[0];
  return {name:engineSelect.selectedOptions[0].textContent+' '+option.textContent,text:previewLines[option.dataset.lang]};
}
function chooseEngine(){
  const mode=engineSelect.value, local=mode==='local';
  byId('neuralFields').hidden=!local;
  byId('onlineFields').hidden=local;
  byId('pollyLogin').hidden=mode!=='polly';
  if(local){updateVoice();return;}
  onlineVoice.replaceChildren();
  for(const family of families) {
    family[mode].forEach((voice,i)=>{
      const title=mode==='polly'?voice:family.names[i];
      const option=new Option(family.label+' · '+title,voice);
      option.dataset.lang=family.lang;
      onlineVoice.add(option);
    });
  }
  byId('sampleText').textContent=selectedExample().text;
  byId('engineNote').textContent=mode==='polly'?'字幕通过 Puter 发送至 Amazon Polly，使用你自己的 Puter 额度。首次使用请连接账户。':'字幕发送至微软 Azure Speech，使用站点额度。人物名称对应原版选择器中的标准音色。';
  if(mode==='polly')mountPolly();
}
function pollyAudio(text,voice,signal){
  signal.throwIfAborted();
  if(!pollyReady || !bridgePort)throw new Error('请先连接自己的 Puter 账户。');
  const language=families.find(f=>f.polly.includes(voice)).locale;
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    function finish(data){
      signal.removeEventListener('abort',abort);
      pendingSpeech.delete(id);
      if(data.error)reject(new Error(data.error));
      else resolve(data.bytes);
    }
    function abort(){finish({error:signal.reason?.message || '已取消'});}
    signal.addEventListener('abort',abort,{once:true});
    pendingSpeech.set(id,finish);
    bridgePort.postMessage({id,text,voice,language});
  });
}
async function onlineSpeech(text,settings,signal){
  const parts=text.match(/[\s\S]{1,2800}/gu) || [];
  const channels=[];
  for(const part of parts){
    const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(90000)]);
    let bytes;
    if(settings.engine==='polly')bytes=await pollyAudio(part,settings.voice,requestSignal);
    else {
      const res=await fetch('/api/original-tts',{method:'POST',signal:requestSignal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify({text:part,voice:settings.voice,rate:settings.rate})});
      if(!res.ok)throw new Error((await res.json()).error || '原版音色合成失败。');
      bytes=await res.arrayBuffer();
    }
    const context=new OfflineAudioContext(1,1,SAMPLE_RATE);
    const decoded=await context.decodeAudioData(bytes);
    channels.push(Int16Array.from(decoded.getChannelData(0),v=>Math.round(Math.max(-1,Math.min(1,v))*32767)));
  }
  const samples=new Int16Array(channels.reduce((sum,chunk)=>sum+chunk.length,0));
  let offset=0;
  for(const channel of channels){samples.set(channel,offset);offset+=channel.length;}
  return settings.engine==='polly' && settings.rate?fitDuration(samples,Math.max(1,Math.round(samples.length/(1+settings.rate/100)))):samples;
}
if(document.documentElement.dataset.originalTts==='1'){
  const option=engineSelect.querySelector('[value=original]');
  option.disabled=false;
  option.textContent='原版 TTS · Azure Speech';
}
engineSelect.addEventListener('change',chooseEngine);
onlineVoice.addEventListener('change',()=>{byId('sampleText').textContent=selectedExample().text;});
