const voices = new Set([
  'ja-JP-KeitaNeural', 'ja-JP-NanamiNeural', 'ko-KR-InJoonNeural', 'ko-KR-SunHiNeural',
  'en-US-GuyNeural', 'en-US-JennyNeural', 'de-DE-KillianNeural', 'de-DE-KatjaNeural'
]);

function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export async function azureSpeech(request,env) {
    const url=new URL(request.url);
    const headers={'Cache-Control':'no-store'};
    const fail=(status,error)=>Response.json({error},{status,headers});
    const region = (env.AZURE_SPEECH_REGION || '').trim().toLowerCase();
    const ready = Boolean(/^[a-z][a-z0-9]{1,40}$/.test(region) && env.AZURE_SPEECH_KEY?.trim());
    if (url.pathname === '/api/status' && request.method === 'GET')
      return Response.json({service:'azure-srt', configured:ready}, {headers});
    if (url.pathname !== '/api/speech') return fail(404, '未知接口。');
    if (request.method !== 'POST') return fail(405, '需要 POST 请求。');
    if (!ready) return fail(503, '站点尚未配置微软语音。');
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json')
      return fail(415, '需要 JSON 请求。');
    if (+request.headers.get('Content-Length') > 32768) return fail(413, '单条字幕过长。');
    let data;
    try { data = await request.json(); } catch { return fail(400, '无效的请求。'); }
    if (!data || !voices.has(data.voice) || typeof data.text !== 'string' ||
        !data.text.trim() || data.text.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(data.text) ||
        !Number.isInteger(data.rate) || data.rate < -50 || data.rate > 100)
      return fail(400, '请检查音色、语速和字幕内容（每条最多 4000 字符）。');
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (env.SPEECH_LIMIT && !(await env.SPEECH_LIMIT.limit({key:ip})).success) {
      headers['Retry-After'] = '60';
      return fail(429, '请求较密集，请稍后重试。');
    }
    const lang = data.voice.slice(0,5);
    const rate = (data.rate >= 0 ? '+' : '') + data.rate + '%';
    const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + lang +
      '"><voice name="' + data.voice + '"><prosody rate="' + rate + '">' +
      escapeXml(data.text) + '</prosody></voice></speak>';
    try {
      const speech = await fetch('https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', {
        method:'POST', redirect:'manual', signal:request.signal, headers:{
          'Ocp-Apim-Subscription-Key':env.AZURE_SPEECH_KEY.trim(), 'Content-Type':'application/ssml+xml',
          'X-Microsoft-OutputFormat':'riff-22050hz-16bit-mono-pcm', 'User-Agent':'SrtVoiceStudio'
        }, body:ssml
      });
      if (speech.ok) return new Response(speech.body, {headers:{...headers, 'Content-Type':'audio/wav'}});
      await speech.body?.cancel();
      if (speech.status === 429) {
        headers['Retry-After'] = speech.headers.get('Retry-After') || '60';
        return fail(429, '微软语音已限流或本月额度已用完。');
      }
      if ([401,403].includes(speech.status)) return fail(503, '请站点管理员检查 Azure 区域、密钥及资源权限。');
      return fail(502, '微软语音暂时无法生成这段字幕（HTTP ' + speech.status + '）。');
    } catch { return fail(502, '连接微软语音失败，请稍后重试。'); }
}
