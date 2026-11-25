let speechWorker;
function stopWorker() {
  if (speechWorker) speechWorker.terminate();
  speechWorker = null;
}
const localCacheName = 'srt-local-speech';
const localFiles = ['./engine/espeak-acf4a598457b.js','./engine/voices-ccb1881280f4.bin'];
const localSizes = [179311, 9129834];
const downloadButton = document.getElementById('downloadEngine');
let downloading = false;

async function cachedEngine() {
  if (!window.caches) throw new Error('此浏览器不支持引擎缓存。请使用支持缓存的浏览器，或选择云端配音。');
  const cache = await caches.open(localCacheName);
  return Promise.all(localFiles.map(async file => {
    const saved = await cache.match(file);
    return saved?.headers.get('Content-Type')?.includes('text/html') ? undefined : saved;
  }));
}

async function showCacheState() {
  try {
    const files = await cachedEngine();
    if (downloading) return;
    const ready = files.every(Boolean);
    downloadButton.disabled = ready;
    downloadButton.textContent = ready ? '引擎已缓存' : '下载并缓存引擎（9.3 MB）';
  } catch (error) {
    downloadButton.disabled = true;
    downloadButton.textContent = error.message;
  }
}

downloadButton.addEventListener('click', async () => {
  if (downloading) return;
  downloading = true;
  downloadButton.disabled = true;
  downloadButton.textContent = '正在下载引擎…';
  notice('');
  try {
    const cache = await caches.open(localCacheName);
    const saved = await cachedEngine();
    const total = localSizes.reduce((sum, size) => sum + size, 0);
    let loaded = 0;
    for (const [i,file] of localFiles.entries()) {
      const size = localSizes[i];
      if (!saved[i]) {
        const response = await fetch(file, {redirect:'error'});
        if (!response.ok || !response.body || response.headers.get('Content-Type')?.includes('text/html'))
          throw new Error('获取引擎失败');
        const reader = response.body.getReader();
        const bytes = new Uint8Array(size);
        let offset = 0;
        while (true) {
          const {value,done} = await reader.read();
          if (done) break;
          bytes.set(value,offset);
          offset += value.length;
          const mb = ((loaded + offset) / 1e6).toFixed(1);
          downloadButton.textContent = '正在下载 · ' + mb + ' / ' + (total / 1e6).toFixed(1) + ' MB';
        }
        if (offset !== size) throw new Error('引擎文件不完整');
        await cache.put(file,new Response(bytes));
      }
      loaded += size;
    }
  } catch {
    notice('引擎缓存失败，请检查网络和浏览器存储空间后重试。');
  } finally {
    downloading = false;
    await showCacheState();
  }
});

async function generateSpeech(text, settings, signal) {
  signal.throwIfAborted();
  let voicePack;
  if (!speechWorker) {
    const [loader, pack] = await cachedEngine();
    if (!loader || !pack) {
      await showCacheState();
      throw new Error('请先点击“下载并缓存引擎”，完成后再开始配音。');
    }
    const workerBlob = new Blob([await loader.arrayBuffer()],{type:'text/javascript'});
    voicePack = await pack.blob();
    signal.throwIfAborted();
    const url = URL.createObjectURL(workerBlob);
    try { speechWorker = new Worker(url); } finally { URL.revokeObjectURL(url); }
  }
  return new Promise((resolve,reject) => {
    const abort = () => { stopWorker(); reject(new DOMException('任务已取消','AbortError')); };
    signal.addEventListener('abort',abort,{once:true});
    speechWorker.onmessage = ({data}) => {
      signal.removeEventListener('abort',abort);
      if (data.error) reject(new Error(data.error));
      else resolve(data.buffer);
    };
    speechWorker.onerror = event => {
      signal.removeEventListener('abort',abort);
      stopWorker(); reject(new Error(event.message || '浏览器无法启动语音引擎。'));
    };
    speechWorker.postMessage({voicePack,text,voice:settings.voice,rate:settings.rate});
  });
}
'use strict';

const SAMPLE_RATE = 22050;

function subtitleText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

function parseSrt(source) {
  const blocks = source.trim().replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
  const stamp = /^(\d+):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/;
  const samples = value => {
    const match = stamp.exec(value);
    if (!match) return NaN;
    return Math.round(SAMPLE_RATE * (+match[1] * 3600 + +match[2] * 60 + +match[3] + +match[4].padEnd(3, '0') / 1000));
  };
  return blocks.map((block, index) => {
    const lines = block.split('\n');
    if (/^\s*\d+\s*$/.test(lines[0])) lines.shift();
    const times = lines.shift().trim().match(/^(\S+)\s*-->\s*(\S+)(?:\s+.*)?$/);
    const start = times && samples(times[1]);
    const end = times && samples(times[2]);
    const text = lines.join(' ').replace(/<\/?(?:b|i|u|font)\b[^>]*>/gi, '').trim();
    if (!times || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text)
      throw new Error('请检查第 ' + (index + 1) + ' 段的时间码和字幕文字。');
    if (end > SAMPLE_RATE * 3600 * 6) throw new Error('本机版单个文件的时间轴上限为 6 小时。');
    return {start, end, text};
  });
}

function readSpeech(buffer) {
  const view = new DataView(buffer);
  for (let at = 12; at + 8 <= buffer.byteLength;) {
    const size = view.getUint32(at + 4, true);
    if (view.getUint32(at) === 0x64617461 && at + 8 + size <= buffer.byteLength) {
      const audio = new Int16Array(buffer, at + 8, Math.floor(size / 2));
      let start = 0, end = audio.length;
      while (start < end && Math.abs(audio[start]) < 32) start++;
      while (end > start && Math.abs(audio[end - 1]) < 32) end--;
      if (end === start) throw new Error('这段文字没有生成可听语音。');
      return audio.subarray(Math.max(0, start - 100), Math.min(audio.length, end + 150));
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('系统返回的音频格式无法读取。');
}

// Estimate a representative voiced pitch for the Hz offset shown by the UI.
function basePitch(input) {
  const periods = [];
  const stride = Math.max(512, Math.floor(input.length / 20));
  for (let i = 0; i + 800 < input.length; i += stride) {
    let best = 0.65, period = 0;
    for (let lag = 55; lag < 300; lag++) {
      let cross = 0, a = 1, b = 1;
      for (let j = 0; j < 480; j += 4) {
        const x = input[i+j], y = input[i+j+lag];
        cross += x*y; a += x*x; b += y*y;
      }
      const score = cross / Math.sqrt(a*b) - lag * 0.00018;
      if (score > best) { best = score; period = lag; }
    }
    if (period) periods.push(SAMPLE_RATE / period);
  }
  periods.sort((a,b) => a-b);
  return periods[Math.floor(periods.length / 2)] || 165;
}

function resample(source, ratio) {
  const result = new Int16Array(Math.max(1, Math.round(source.length / ratio)));
  for (let i = 0; i < result.length; i++) {
    const pos = Math.min(i * ratio, source.length - 1);
    const left = Math.floor(pos);
    result[i] = source[left] + (pos-left) * (source[Math.min(left+1,source.length-1)]-source[left]);
  }
  return result;
}

// Waveform-similarity overlap-add keeps speech pitch stable as duration changes.
function fitDuration(source, length) {
  if (source.length === length) return source;
  const hop = Math.min(330, Math.floor(Math.min(source.length, length) / 4));
  if (hop < 8) return resample(source, source.length / length);
  const result = new Int16Array(length);
  result.set(source.subarray(0, hop*2));
  for (let out = hop; out < length; out += hop) {
    const count = Math.min(hop*2, length-out);
    const expected = Math.round(out * (source.length - hop*2) / (length-hop*2));
    const center = Math.min(source.length - count, expected);
    let best = center, score = -Infinity;
    const low = Math.max(0, center - 145), high = Math.min(source.length-count, center+145);
    for (let pos = low; pos <= high; pos += 3) {
      let dot = 0, power = 1;
      for (let j = 0; j < Math.min(count,hop); j += 5) {
        dot += result[out+j]*source[pos+j];
        power += source[pos+j]*source[pos+j];
      }
      const similarity = dot / Math.sqrt(power);
      if (similarity > score) { best = pos; score = similarity; }
    }
    for (let j = 0; j < count; j++) {
      const blend = Math.min(j / hop, 1);
      result[out+j] = result[out+j]*(1-blend) + source[best+j]*blend;
    }
  }
  return result;
}

class WaveTimeline {
  constructor() { this.pages = new Map(); this.length = 0; }
  add(cue, source, settings) {
    const duration = cue.end - cue.start;
    const length = settings.stretch ? duration : Math.min(duration, source.length);
    if (settings.pitch) {
      const base = basePitch(source);
      source = resample(source, Math.max(0.35, (base + settings.pitch) / base));
    }
    const clip = fitDuration(source, length);
    const gain = 1 + settings.volume / 100;
    for (let i = 0; i < length;) {
      const time = cue.start + i;
      const index = Math.floor(time / SAMPLE_RATE);
      const offset = time % SAMPLE_RATE;
      if (!this.pages.has(index)) this.pages.set(index, new Int16Array(SAMPLE_RATE));
      const page = this.pages.get(index);
      const count = Math.min(SAMPLE_RATE-offset, length-i);
      for (let j = 0; j < count; j++) {
        page[offset+j] = Math.max(-32768, Math.min(32767, page[offset+j] + gain*clip[i+j]));
      }
      i += count;
    }
    this.length = Math.max(this.length, cue.end);
  }
  wav() {
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    v.setUint32(0,0x52494646); v.setUint32(4,36+this.length*2,true);
    v.setUint32(8,0x57415645); v.setUint32(12,0x666d7420);
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
    v.setUint32(24,SAMPLE_RATE,true); v.setUint32(28,SAMPLE_RATE*2,true);
    v.setUint16(32,2,true); v.setUint16(34,16,true); v.setUint32(36,0x64617461);
    v.setUint32(40,this.length*2,true);
    const parts = [header], silence = new Int16Array(SAMPLE_RATE);
    for (let start = 0; start < this.length; start += SAMPLE_RATE) {
      const page = this.pages.get(start / SAMPLE_RATE) || silence;
      parts.push(page.subarray(0, this.length-start));
    }
    return new Blob(parts, {type:'audio/wav'});
  }
}
'use strict';

const byId = id => document.getElementById(id);
const sliders = [
  ['rateSlider', 'rateVal', '%'], ['pitchSlider', 'pitchVal', 'Hz'], ['volumeSlider', 'volVal', '%']
];
function updateValue(id, output, unit, signed, manual) {
  const value = Number(byId(id).value);
  byId(output).textContent = (signed && value >= 0 ? '+' : '') + value + unit;
  if (manual) document.querySelectorAll('.preset-btn.active').forEach(button => button.classList.remove('active'));
}
function resetSlider(id, value, output, unit, signed) {
  byId(id).value = value;
  updateValue(id, output, unit, signed, true);
}
function applyPreset(rate, pitch, volume, button) {
  sliders.forEach(([id, output, unit], i) => resetSlider(id, [rate,pitch,volume][i], output, unit, true));
  button.classList.add('active');
}
function toggleAutoDl() {
  try { localStorage.setItem('autoDownload', byId('autoDlToggle').checked); } catch {}
}
function notice(text) {
  byId('notice').textContent = text;
  byId('notice').hidden = !text;
}

const database = new Promise((resolve, reject) => {
  const request = indexedDB.open(document.documentElement.dataset.history || 'local-srt-history', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('finished', {keyPath: 'id'});
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function historyAction(mode, action) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('finished', mode);
    const request = action(tx.objectStore('finished'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
function element(tag, cls, label) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (label) node.textContent = label;
  return node;
}

const tasks = [];
function taskRow(name) {
  const row = element('div','task-item');
  const info = element('div','task-info');
  const status = element('span','status-queued','等待执行');
  const actions = element('div','task-actions');
  const abort = new AbortController();
  const task = {row, status, actions, abort, done: false};
  const cancel = element('button','btn-cancel','取消');
  cancel.onclick = () => {
    abort.abort();
    finishTask(task, '已取消', 'status-error');
  };
  actions.append(cancel);
  info.append(element('strong', '', name), status);
  row.append(info, actions);
  byId('taskList').prepend(row);
  tasks.push(task);
  return task;
}
function finishTask(task, text, style) {
  task.done = true;
  task.status.className = style;
  task.status.textContent = text;
  task.actions.replaceChildren();
}
function displayResult(task, record) {
  finishTask(task, '配音完成', 'status-success');
  task.url = URL.createObjectURL(record.audio);
  const player = element('audio');
  player.controls = true;
  player.preload = 'none';
  player.src = task.url;
  player.setAttribute('aria-label', '试听 ' + record.name);
  task.row.append(player);
  const link = element('a','','下载 WAV');
  link.href = task.url;
  link.download = record.name.replace(/\.srt$/i, '') + '.wav';
  task.actions.append(link);
  return link;
}
async function clearFinishedTasks() {
  await restored;
  const finished = tasks.filter(task => task.done);
  try {
    if (finished.length) await historyAction('readwrite', store => {
      let request = store.count();
      for (const task of finished) if (task.id) request = store.delete(task.id);
      return request;
    });
  } catch { notice('浏览器历史记录暂时无法访问。'); }
  for (const task of finished) {
    task.row.remove();
    if (task.url) URL.revokeObjectURL(task.url);
    const index = tasks.indexOf(task);
    if (index >= 0) tasks.splice(index,1);
  }
}
const restored = (async () => {
  try {
    const records = await historyAction('readonly', store => store.getAll());
    for (const record of records.sort((a,b) => a.created-b.created)) {
      const task = taskRow(record.name);
      task.id = record.id;
      displayResult(task,record);
    }
  } catch { notice('浏览器历史记录暂时无法访问，仍可在本页生成并下载。'); }
})();
try { byId('autoDlToggle').checked = localStorage.getItem('autoDownload') === 'true'; } catch {}

async function convert(file, task, settings) {
  const signal = task.abort.signal;
  if (signal.aborted) return;
  try {
    const cues = parseSrt(subtitleText(await file.arrayBuffer()));
    const timeline = new WaveTimeline();
    for (const [i, cue] of cues.entries()) {
      task.status.className = 'status-loading';
      task.status.textContent = '正在配音 · ' + (i + 1) + ' / ' + cues.length;
      const samples = settings.engine === 'local'
        ? readSpeech(await generateSpeech(cue.text,settings,signal))
        : await providerSamples(cue.text,settings,signal,message => { task.status.textContent = message; });
      signal.throwIfAborted();
      timeline.add(cue,samples,settings);
    }
    if (signal.aborted) return;
    const record = {id:crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'), name:file.name, created:Date.now(), audio:timeline.wav()};
    task.id = record.id;
    const link = displayResult(task,record);
    if (byId('autoDlToggle').checked) link.click();
    try { await historyAction('readwrite', store => store.put(record)); }
    catch { notice('浏览器未能保存历史记录，请在关闭页面前下载音频。'); }
  } catch (error) {
    if (!signal.aborted) {
      finishTask(task, '配音失败 · ' + error.message, 'status-error');
      if (error.offerLocal) {
        const switchButton = element('button','','切换到本地配音');
        switchButton.onclick = selectLocalSpeech;
        task.actions.append(switchButton);
      }
    }
  }
}
async function startBatchConversion(example = false) {
  const input = byId('srtFiles');
  const files = Array.from(input.files);
  if (example) {
    const {name,text} = currentExample();
    const filename = name.replace(/[^\p{L}\p{N} ._-]/gu,' ').replace(/\s+/g,' ').trim();
    files.splice(0,files.length,new File(['1\n00:00:00,000 --> 00:00:05,000\n'+text], '试听 '+filename+'.srt'));
  }
  if (!files.length) { notice('请先选择一个或多个 SRT 字幕文件。'); input.focus(); return; }
  const submit = byId('submitBtn');
  if (submit.disabled) return;
  submit.disabled = true;
  byId('sampleBtn').disabled = true;
  notice('');
  try {
    await restored;
    const settings = {...providerSettings(), voice:byId('voiceSelect').value, stretch:byId('speedModeSelect').selectedIndex === 1,
      rate:+byId('rateSlider').value, pitch:+byId('pitchSlider').value, volume:+byId('volumeSlider').value};
    if (settings.engine === 'local' && !(await cachedEngine()).every(Boolean)) {
      notice(downloading ? '引擎下载完成后即可配音。' : '请先下载并缓存本地引擎。');
      downloadButton.focus();
      return;
    }
    const batch = files.map(file => ({file, task:taskRow(file.name)}));
    for (const [i, entry] of batch.entries()) {
      submit.textContent = '正在配音 · ' + (i+1) + ' / ' + files.length;
      await convert(entry.file,entry.task,settings);
    }
  } catch (error) { notice(error.message); } finally { submit.disabled = false; byId('sampleBtn').disabled = false; submit.textContent = '开始配音'; }
}
