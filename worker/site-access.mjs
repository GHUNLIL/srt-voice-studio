// The production build supplies only the digest of a randomly generated login.
const builtLoginHash = '__SITE_LOGIN_SHA256__';

export async function requireLogin(request, env) {
  const expected = env.SITE_LOGIN_SHA256 || builtLoginHash;
  const basic = /^Basic ([A-Za-z0-9+/]+=*)$/i.exec(request.headers.get('Authorization') || '');
  if (basic && /^[a-f0-9]{64}$/.test(expected)) {
    let decoded;
    try { decoded = atob(basic[1]); } catch {}
    if (decoded) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(decoded)));
      let diff = 0;
      for (let i = 0; i < digest.length; i++) diff |= digest[i] ^ parseInt(expected.slice(2*i,2*i+2),16);
      if (diff === 0) return null;
    }
  }
  return new Response('请使用站点账号和密码登录。', {status:401, headers:{
    'WWW-Authenticate':'Basic realm="UNLIL SRT", charset="UTF-8"',
    'Cache-Control':'private, no-store', 'Content-Type':'text/plain; charset=utf-8'
  }});
}

export function privateResponse(response, pathname) {
  const result = new Response(response.body,response);
  const engineAsset = response.ok && /^\/engine\/(voices-[0-9a-f]{12}\.bin|espeak-[0-9a-f]{12}\.js)$/.test(pathname);
  result.headers.set('Cache-Control',engineAsset ? 'private, max-age=31536000, immutable' : 'private, no-store');
  result.headers.set('Referrer-Policy','no-referrer');
  return result;
}
