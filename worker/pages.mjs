import {sub2Speech} from './sub2api.mjs';
import {requireLogin, privateResponse} from './site-access.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'srt.unlil.com' && url.pathname === '/' && !url.searchParams.has('history') && ['GET','HEAD'].includes(request.method)) {
      url.hostname = 'srtvoice.unlil.com';
      return Response.redirect(url.href, 301);
    }
    const denial = await requireLogin(request, env);
    if (denial) return denial;
    const path = url.pathname;
    if (path === '/api/sub2api/speech') return sub2Speech(request, env);
    if (path === '/api/status') return Response.json({service:'azure-srt',configured:false}, {headers:{'Cache-Control':'no-store'}});
    const headers = new Headers(request.headers);
    headers.delete('Authorization');
    return privateResponse(await env.ASSETS.fetch(new Request(request,{headers})), path);
  }
};
