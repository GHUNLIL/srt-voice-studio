'use strict';

const microsoftVoices = new Map([
  ['ja+m3','ja-JP-KeitaNeural'], ['ja+f3','ja-JP-NanamiNeural'],
  ['ko+m3','ko-KR-InJoonNeural'], ['ko+f3','ko-KR-SunHiNeural'],
  ['en-us+m3','en-US-GuyNeural'], ['en-us+f3','en-US-JennyNeural'],
  ['de+m3','de-DE-KillianNeural'], ['de+f3','de-DE-KatjaNeural']
]);
let speechOrigin;
const engine = document.getElementById('engineSelect');
const voiceList = document.getElementById('voiceSelect');
const originalNames = Array.from(voiceList.options, option => option.textContent);
const chineseVoices = [['cmn+m3','中文男声','zh-CN-YunxiNeural'], ['cmn+f3','中文女声','zh-CN-XiaoxiaoNeural']];
for (const [id,label,voice] of chineseVoices) {
  microsoftVoices.set(id,voice);
  voiceList.add(new Option(label,id));
  originalNames.push(label);
}
function updateProvider() {
  const mode = engine.value;
  const microsoft = mode === 'azure' || mode === 'azure-key';
  byId('azureFields').hidden = mode !== 'azure-key';
  byId('customFields').hidden = mode !== 'compatible';
  voiceList.hidden = mode === 'compatible';
  document.querySelector('label[for="voiceSelect"]').hidden = voiceList.hidden;
  for (const [i, option] of Array.from(voiceList.options).entries()) {
    const name = microsoftVoices.get(option.value).split('-')[2].replace('Neural','');
    option.hidden = mode === 'azure' && option.value.startsWith('cmn');
    option.textContent = microsoft ? originalNames[i] + ' · ' + name : originalNames[i];
  }
  if (voiceList.selectedOptions[0]?.hidden) voiceList.selectedIndex = 0;
  const notes = {
    local:'字幕和配音均在浏览器内处理。',
    azure:'字幕正文将通过站点后端发送至微软合成。',
    'azure-key':'每段字幕和密钥直接发送给微软。密钥仅用于本页，刷新后需重新填写。',
    compatible:'每段字幕和密钥将直接发送到下方地址。请填写你信任且支持浏览器跨域请求的语音接口，费用计入该密钥所属账户。'
  };
  byId('engineNote').textContent = notes[mode];
}
engine.addEventListener('change', updateProvider);
byId('speechUrl').addEventListener('input', () => { byId('customKey').value = ''; });
updateProvider();

function providerSettings() {
  const mode = engine.value;
  const value = id => byId(id).value.trim();
  if (mode === 'azure-key') {
    const region = value('azureRegion').toLowerCase();
    if (!/^[a-z][a-z0-9]{1,40}$/.test(region) || !value('azureKey'))
      throw new Error('请填写 Azure 区域短名和 Speech 资源密钥。');
    return {engine:mode, url:'https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', key:value('azureKey')};
  }
  if (mode === 'compatible') {
    let url;
    try { url = new URL(value('speechUrl')); } catch {}
    if (url?.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('请填写语音合成接口的完整 HTTPS 地址。');
    const model = value('speechModel'), voiceId = value('customVoice'), key = value('customKey');
    if (!model || !voiceId || !key) throw new Error('请填写模型名称、音色 ID 和接口密钥。');
    return {engine:mode,url:url.href,model,voiceId,key};
  }
  return {engine:mode};
}

async function providerSamples(text, settings, signal, report) {
  if (settings.engine === 'azure') return readSpeech(await azureSpeech(text,settings,signal,report));
  const microsoft = settings.engine === 'azure-key';
  let headers, body;
  if (microsoft) {
    const voice = microsoftVoices.get(settings.voice);
    const escaped = text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const rate = (settings.rate >= 0 ? '+' : '') + settings.rate + '%';
    headers = {'Ocp-Apim-Subscription-Key':settings.key,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'riff-22050hz-16bit-mono-pcm'};
    body = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="'+voice.slice(0,5)+'"><voice name="'+voice+'"><prosody rate="'+rate+'">'+escaped+'</prosody></voice></speak>';
  } else {
    headers = {Authorization:'Bearer ' + settings.key,'Content-Type':'application/json'};
    body = JSON.stringify({input:text,model:settings.model,voice:settings.voiceId,speed:1+settings.rate/100,response_format:'wav'});
  }
  let response;
  try {
    response = await fetch(settings.url,{method:'POST',headers,body,signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
  } catch (error) {
    signal.throwIfAborted();
    throw new Error('无法连接语音接口，请检查地址、网络和服务端跨域设置。');
  }
  if (!response.ok) {
    const hints = {400:'请检查模型、音色和字幕内容。',401:'请检查密钥及资源区域。',403:'请检查密钥权限及资源区域。',404:'请检查接口地址和模型名称。',429:'请检查配额，或稍后重试。'};
    throw new Error('语音接口返回 HTTP '+response.status+'。'+(hints[response.status] || '请检查服务状态。'));
  }
  const audio = await response.arrayBuffer();
  if (microsoft) return readSpeech(audio);
  // Decode and mix the provider's sample rate and channel layout onto the subtitle timeline.
  const context = new OfflineAudioContext(1,1,SAMPLE_RATE);
  const decoded = await context.decodeAudioData(audio);
  const render = new OfflineAudioContext(1,decoded.length,SAMPLE_RATE);
  const source = render.createBufferSource();
  source.buffer = decoded;
  source.connect(render.destination);
  source.start();
  const mono = (await render.startRendering()).getChannelData(0);
  return Int16Array.from(mono, sample => Math.round(Math.min(1,Math.max(-1,sample))*32767));
}

async function discoverCloudSpeech() {
  if (location.protocol === 'file:') return;
  try {
    const config = await fetch('./speech-config.json', {cache:'no-cache'}).then(r => r.json());
    if (!config.workerOrigin && location.hostname === 'ghunlil.github.io') return;
    const origin = config.workerOrigin ? new URL(config.workerOrigin).origin : location.origin;
    if (origin !== location.origin && !origin.startsWith('https://')) return;
    const response = await fetch(origin + '/api/status', {signal:AbortSignal.timeout(6000)});
    if (!response.ok) return;
    const data = await response.json();
    if (data.service !== 'azure-srt' || !data.configured) return;
    speechOrigin = origin;
    const shared = engine.querySelector('option[value="azure"]');
    shared.hidden = false;
    shared.disabled = false;
  } catch { /* Local synthesis is available when hosting is static or the API is offline. */ }
}

function waitForThrottle(ms, signal) {
  return new Promise((resolve,reject) => {
    signal.throwIfAborted();
    function onAbort() { clearTimeout(timer); reject(signal.reason); }
    const timer = setTimeout(() => { signal.removeEventListener('abort',onAbort); resolve(); }, ms);
    signal.addEventListener('abort',onAbort,{once:true});
  });
}

async function azureSpeech(text, settings, signal, report) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(speechOrigin + '/api/speech', {
      method:'POST', headers:{'Content-Type':'application/json'}, signal,
      body:JSON.stringify({voice:microsoftVoices.get(settings.voice),text,rate:settings.rate})
    });
    if (response.ok) return response.arrayBuffer();
    const failure = await response.json().catch(() => ({}));
    const seconds = Number(response.headers.get('Retry-After')) || 60;
    if (response.status !== 429 || attempt >= 1 || seconds > 120)
      throw new Error(failure.error || '微软语音请求失败。');
    report('微软语音限流，' + seconds + ' 秒后重试');
    await waitForThrottle(Math.max(seconds,1)*1000,signal);
  }
}
discoverCloudSpeech();
