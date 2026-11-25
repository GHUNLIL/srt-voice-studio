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
engine.addEventListener('change', () => {
  const cloud = engine.value === 'azure';
  for (const [i, option] of Array.from(voiceList.options).entries()) {
    const name = microsoftVoices.get(option.value).split('-')[2].replace('Neural','');
    option.textContent = cloud ? originalNames[i] + ' · ' + name : originalNames[i];
  }
  document.getElementById('engineNote').textContent = cloud ?
    '字幕正文将发送至微软合成，WAV 在浏览器内生成。' : '字幕和配音均在浏览器内处理。';
});

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
    engine.options[1].disabled = false;
    engine.options[1].textContent = '微软神经语音（Azure）';
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
