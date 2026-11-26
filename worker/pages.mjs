import {azureSpeech,saveAzure} from './speech.mjs';
import {setupDB,sessionUser,login,json,problem,q,getBalance,billedSpeech,sessionToken,sha256} from './accounts.mjs';
import {settingsView,saveSettings,createRecharge,settleOrder,loadMerchant,paymentNotify} from './pay.mjs';

async function asset(request,env,path,user) {
  const url=new URL(request.url);url.pathname=path;url.search='';
  const headers=new Headers(request.headers);headers.delete('Cookie');headers.delete('Authorization');
  let res=await env.ASSETS.fetch(new Request(url,{headers,method:request.method==='HEAD'?'HEAD':'GET'}));
  if(path==='/' && user && request.method!=='HEAD'){
    const cfg=await settingsView(env.DB);
    res=new HTMLRewriter().on('html',{element(el){
      el.setAttribute('data-history',user.admin?'local-srt-history':'srt-user-'+user.id);
      el.setAttribute('data-rate',String(user.admin?0:cfg.rate));
    }}).transform(res);
  }
  const out=new Response(res.body,res);
  out.headers.set('Cache-Control',path.startsWith('/engine/')?'private, max-age=31536000, immutable':'private, no-store');
  out.headers.set('Referrer-Policy','no-referrer');out.headers.set('X-Content-Type-Options','nosniff');out.headers.set('X-Frame-Options','DENY');
  return out;
}

async function readObject(request) {
  let data;
  try { data=await request.json(); } catch {problem(400,'无效 JSON。');}
  if(!data || Array.isArray(data) || typeof data!=='object') problem(400,'无效的请求。');
  return data;
}

async function route(request,env){
  const url=new URL(request.url), path=url.pathname, db=env.DB;
  if(url.hostname==='srt.unlil.com') return new Response('此地址已停用。',{status:410});
  const post=request.method==='POST';
  if(!post && !['GET','HEAD'].includes(request.method)) problem(405,'请求方法无效。');
  if(path==='/api/payment/notify') {await setupDB(db,env);return paymentNotify(request,env);}
  if(post && request.headers.get('Origin')!==url.origin) problem(403,'请从本站提交。');
  if(post && !request.headers.get('Content-Type')?.startsWith('application/json')) problem(415,'需要 JSON 请求。');
  if(path==='/login'&&!post) return asset(request,env,'/login');
  await setupDB(db,env);
  if(post && ['/api/login','/api/register'].includes(path)) return login(db,request,await readObject(request),path==='/api/register');
  const user=await sessionUser(db,request);
  if(!user){
    if(path.startsWith('/api/')) problem(401,'请先登录。');
    return new Response(null,{status:302,headers:{Location:'/login','Cache-Control':'no-store'}});
  }
  if(path==='/api/logout'&&post){
    await q(db,'DELETE FROM sessions WHERE token=?',await sha256(sessionToken(request))).run();
    return json({ok:true},200,{'Set-Cookie':'__Host-srtvoice=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
  }
  if(path==='/api/me'&&!post){
    const cfg=await settingsView(db);
    const {results:orders}=await q(db,'SELECT id,cents,points,paid,created FROM orders WHERE uid=? ORDER BY created DESC,rowid DESC LIMIT 30',user.id).all();
    return json({name:user.name,admin:!!user.admin,balance:await getBalance(db,user.id),ratio:cfg.ratio,rate:cfg.rate,enabled:!!(cfg.ratio&&cfg.mid),channel:cfg.channel,orders,...(user.admin?{pid:cfg.pid}:{})});
  }
  if(path==='/api/admin/azure' && post) {
    if(!user.admin) problem(403,'需要管理员权限。');
    return saveAzure(env,await readObject(request));
  }
  if(path==='/api/admin/settings'&&post){
    if(!user.admin) problem(403,'需要管理员权限。');
    return saveSettings(env,await readObject(request));
  }
  if(path==='/api/recharge'&&post) return createRecharge(env,user,await readObject(request));
  if(path==='/api/order/check'&&post){
    const {id}=await readObject(request);
    const order=await q(db,'SELECT * FROM orders WHERE id=? AND uid=?',String(id),user.id).first();
    if(!order) problem(404,'未知订单。');
    return json({paid:await settleOrder(env,order,await loadMerchant(env,order.mid))});
  }
  if(path==='/api/sub2api/speech'&&post) return billedSpeech(request,env,user);
  if((path==='/api/status'&&!post)||(path==='/api/speech'&&post)) return azureSpeech(request,env);
  if(path==='/account'&&!post) return asset(request,env,'/account');
  if(!post && (path==='/'||path==='/index.html')) return asset(request,env,'/',user);
  if(!post && (path==='/speech-config.json'||path.startsWith('/engine/'))) return asset(request,env,path);
  problem(404,'页面不存在。');
}
export default {async fetch(request,env){
  try{return await route(request,env);}
  catch(e){return json({error:e.status?e.message:'服务暂不可用，请稍后重试。'},e.status||500);}
}};
