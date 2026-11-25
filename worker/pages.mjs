import {sub2Speech} from './sub2api.mjs';
import {requireLogin, privateResponse} from './site-access.mjs';

export default {
  async fetch(request, env) {
    const denial = await requireLogin(request, env);
    if (denial) return denial;
    const path = new URL(request.url).pathname;
    if (path === '/api/sub2api/speech') return sub2Speech(request, env);
    if (path === '/api/status') return Response.json({service:'azure-srt',configured:false}, {headers:{'Cache-Control':'no-store'}});
    const headers = new Headers(request.headers);
    headers.delete('Authorization');
    return privateResponse(await env.ASSETS.fetch(new Request(request,{headers})));
  }
};
