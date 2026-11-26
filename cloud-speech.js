'use strict';

const microsoftVoices = new Map([
  ['ja+m3','ja-JP-KeitaNeural'], ['ja+f3','ja-JP-NanamiNeural'],
  ['ko+m3','ko-KR-InJoonNeural'], ['ko+f3','ko-KR-SunHiNeural'],
  ['en-us+m3','en-US-GuyNeural'], ['en-us+f3','en-US-JennyNeural'],
  ['de+m3','de-DE-KillianNeural'], ['de+f3','de-DE-KatjaNeural']
]);
let speechOrigin = location.origin;
let sharedSpeechReady;

const engine = document.getElementById('engineSelect');
const voiceList = document.getElementById('voiceSelect');
const originalNames = Array.from(voiceList.options, option => option.textContent);
const chineseVoices = [['cmn+m3','中文男声','zh-CN-YunxiNeural'], ['cmn+f3','中文女声','zh-CN-XiaoxiaoNeural']];
for (const [id,label,voice] of chineseVoices) {
  microsoftVoices.set(id,voice);
  voiceList.add(new Option(label,id));
  originalNames.push(label);
}
let lastLocalVoice = 'cmn+f3';
voiceList.addEventListener('change', () => {
  if (engine.value === 'local') lastLocalVoice = voiceList.value;
});
const chatVoices = 'alloy ash ballad coral echo sage shimmer verse'.split(' ');
const legacyVoices = 'alloy ash coral echo fable onyx nova sage shimmer'.split(' ');
const ttsVoices = [...legacyVoices,'ballad','verse','marin','cedar'];

function selectedSetting(id) {
  const selected = byId(id).value;
  return selected === ':other' ? byId(id+'Other').value.trim() : selected;
}
function updateCustomField(id) {
  byId(id+'Other').hidden = byId(id).value !== ':other';
}
function fillVoices(id, voices) {
  const select = byId(id);
  const previous = select.value;
  const options = voices.map(voice => new Option(
    voice[0].toUpperCase()+voice.slice(1),voice));
  select.replaceChildren(...options,new Option('其他（自定义）',':other'));
  if (previous === ':other' || voices.includes(previous)) select.value = previous;
  updateCustomField(id);
}
for (const id of ['sub2Model','sub2Voice','speechModel','customVoice','azureRegion']) {
  byId(id).addEventListener('change', () => updateCustomField(id));
}
function updateSpeechVoices() {
  const legacy = ['tts-1','tts-1-hd'].includes(byId('speechModel').value);
  fillVoices('customVoice', legacy ? legacyVoices : ttsVoices);
}
fillVoices('sub2Voice',chatVoices);
updateSpeechVoices();
byId('speechModel').addEventListener('change',updateSpeechVoices);

const previewLines = {
  ja:'朝の駅に、まもなく最初の電車が到着します。',
  ko:'해가 뜨자 조용하던 시장이 조금씩 활기를 되찾습니다.',
  'en-us':'The morning train rolls past the lake as the sun comes up.',
  de:'Am frühen Morgen öffnet die kleine Bäckerei am Marktplatz.',
  cmn:'天刚亮，街角的面包店已经飘出了香味。'
};

function currentExample() {
  const mode = engine.value;
  const title = engine.selectedOptions[0].textContent;
  if (mode === 'sub2api' || mode === 'compatible') {
    const chat = mode === 'sub2api';
    const model = selectedSetting(chat ? 'sub2Model' : 'speechModel');
    const voice = selectedSetting(chat ? 'sub2Voice' : 'customVoice');
    return {name:[title,model,voice].filter(Boolean).join(' · '),
      text:chat ? '雨刚停，街上的灯一盏盏亮了起来。我们出发吧。' : '本次列车即将到站，请带好随身物品。'};
  }
  const lang = voiceList.value.split('+')[0];
  return {name:title+' · '+voiceList.selectedOptions[0].textContent, text:previewLines[lang]};
}
function showExample() {
  byId('sampleText').textContent = currentExample().text;
}
voiceList.addEventListener('change',showExample);
function updateProvider() {
  const mode = engine.value;
  byId('localFields').hidden = mode !== 'local';
  byId('useLocal').hidden = mode !== 'sub2api';
  if (mode === 'local') {
    voiceList.value = lastLocalVoice;
    showCacheState();
  }
  const microsoft = mode === 'azure' || mode === 'azure-key';
  byId('azureFields').hidden = mode !== 'azure-key';
  byId('customFields').hidden = mode !== 'compatible';
  byId('sub2Fields').hidden = mode !== 'sub2api';
  voiceList.hidden = mode === 'compatible' || mode === 'sub2api';
  document.querySelector('label[for="voiceSelect"]').hidden = voiceList.hidden;
  for (const [i, option] of Array.from(voiceList.options).entries()) {
    const name = microsoftVoices.get(option.value).split('-')[2].replace('Neural','');
    option.hidden = false;
    option.textContent = microsoft ? originalNames[i] + ' · ' + name : originalNames[i];
  }
  if (voiceList.selectedOptions[0]?.hidden) voiceList.selectedIndex = 0;
  const notes = {
    local:'字幕和配音均在浏览器内处理。',
    azure:sharedSpeechReady === false ? '站点尚未开通微软语音。管理员可在「账户与充值」配置 Azure Speech。' : '由微软合成，含原版日、韩、英、德音色和中文晓晓、云希。',
    'azure-key':'每段字幕和密钥直接发送给微软。密钥仅用于本页，刷新后需重新填写。',
    sub2api:'字幕将通过本站发送至 sub2api.unlil.com，使用站点配额。模型可用性取决于站点分组。',
    compatible:'每段字幕和密钥将直接发送到下方地址。请填写你信任且支持浏览器跨域请求的语音接口，费用计入该密钥所属账户。'
  };
  const rate = Number(document.documentElement.dataset.rate || 0);
  byId('engineNote').textContent = notes[mode] + (mode==='sub2api' ? (rate ? ' 每成功合成一段扣 '+rate+' 点（含试听）。' : ' 当前免费。') : '');
  showExample();
}
function selectLocalSpeech() {
  engine.value = 'local';
  updateProvider();
  engine.focus();
}
byId('useLocal').onclick = selectLocalSpeech;
engine.addEventListener('change', updateProvider);
byId('speechUrl').addEventListener('input', () => { byId('customKey').value = ''; });
updateProvider();

function providerSettings() {
  const mode = engine.value;
  const value = id => byId(id).value.trim();
  if (mode === 'azure-key') {
    const region = selectedSetting('azureRegion').toLowerCase();
    if (!/^[a-z][a-z0-9]{1,40}$/.test(region) || !value('azureKey'))
      throw new Error('请填写 Azure 区域短名和 Speech 资源密钥。');
    return {engine:mode, url:'https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', key:value('azureKey')};
  }
  if (mode === 'sub2api') {
    const model = selectedSetting('sub2Model'), voiceId = selectedSetting('sub2Voice');
    if (!model || !voiceId) throw new Error('请填写音频模型和音色。');
    return {engine:mode,model,voiceId,url:'/api/sub2api/speech'};
  }
  if (mode === 'compatible') {
    let url;
    try { url = new URL(value('speechUrl')); } catch {}
    if (url?.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('请填写语音合成接口的完整 HTTPS 地址。');
    const model = selectedSetting('speechModel'), voiceId = selectedSetting('customVoice'), key = value('customKey');
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
    headers = {'Content-Type':'application/json'};
    if (settings.engine !== 'sub2api') headers.Authorization = 'Bearer ' + settings.key;
    body = JSON.stringify({input:text,model:settings.model,voice:settings.voiceId,speed:1+settings.rate/100,response_format:'wav'});
  }
  let response;
  try {
    response = await fetch(settings.url,{method:'POST',headers,body,signal,credentials:settings.engine === 'sub2api' ? 'same-origin' : 'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
  } catch (error) {
    signal.throwIfAborted();
    throw new Error('无法连接语音接口，请检查地址、网络和服务端跨域设置。');
  }
  if (!response.ok) {
    if (settings.engine === 'sub2api') {
      const failure = await response.json().catch(() => ({}));
      const error = new Error(failure.error || 'Sub2API 配音请求失败。');
      error.offerLocal = response.status === 503;
      throw error;
    }
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
  const samples = Int16Array.from(mono, sample => Math.round(Math.min(1,Math.max(-1,sample))*32767));
  return settings.engine === 'sub2api' && settings.rate ? fitDuration(samples,Math.max(1,Math.round(samples.length/(1+settings.rate/100)))) : samples;
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
    if (data.service !== 'azure-srt') return;
    sharedSpeechReady = data.configured;
    if (engine.value === 'azure') updateProvider();
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
engine.addEventListener('change', () => { if (engine.value === 'azure') discoverCloudSpeech(); });
