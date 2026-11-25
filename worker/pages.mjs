import {sub2Speech} from './sub2api.mjs';

export default {
  fetch(request,env) {
    if (new URL(request.url).pathname === '/api/sub2api/speech') return sub2Speech(request);
    return env.ASSETS.fetch(request);
  }
};
