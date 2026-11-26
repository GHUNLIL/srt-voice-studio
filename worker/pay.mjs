import {problem,json,q,textBytes,hex} from "./accounts.mjs";
const payOrigin='https://pay.unlil.com';
const siteOrigin='https://srtvoice.unlil.com';
function intField(value,min,max,label) {
  if(!Number.isSafeInteger(value)||value<min||value>max) problem(400,label+'超出允许范围。');
  return value;
}
async function encryptCredential(env,data,decrypt=false) {
  const material=env.PAY_WRAPPING_KEY || '__PAY_WRAPPING_KEY__';
  if(!/^[a-f0-9]{64}$/.test(material)) problem(503,'商户密钥加密配置缺失。');
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(material.match(/../g),v=>parseInt(v,16)),'AES-GCM',false,['encrypt','decrypt']);
  if(decrypt){
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12)));
  }
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,textBytes.encode(data)));
  return btoa(String.fromCharCode(...iv,...cipher));
}
async function paySign(params,secret){
  const canonical=Object.keys(params).sort().filter(k=>k!=='sign'&&k!=='sign_type'&&params[k]!=='').map(k=>k+'='+params[k]).join('&');
  return hex(await crypto.subtle.digest('MD5',textBytes.encode(canonical+secret)));
}
async function payCall(path,fields,secret) {
  const params={...fields,sign:await paySign(fields,secret),sign_type:'MD5'};
  let result;
  try{
    const r=await fetch(payOrigin+path,{method:'POST',body:new URLSearchParams(params),redirect:'manual',signal:AbortSignal.timeout(12000)});
    result=await r.json();
  }catch{problem(502,'支付网关暂未响应，请稍后刷新订单。');}
  if(Number(result.code)!==1) problem(502,'支付网关未接受订单，请核对商户和渠道配置。');
  return result;
}
async function settingsView(db){
  return db.prepare('SELECT ratio,mid,channel,COALESCE(m.pid,\'\') AS pid FROM settings s LEFT JOIN merchants m ON s.mid=m.id WHERE s.id=1').first();
}
async function saveSettings(env,data) {
  const db=env.DB, ratio=intField(data.ratio,0,1000000,'每元点数');
  if(!['alipay','stripe','usdt'].includes(data.channel)) problem(400,'渠道无效。');
  const cfg=await settingsView(db);
  const pid=String(data.pid||'').trim(),secret=String(data.secret||'').trim();
  if((pid!==cfg.pid&&!secret)||secret&&(!/^[a-zA-Z0-9_-]{1,64}$/.test(pid)||secret.length>512)) problem(400,'更换商户须同时填写 PID 和签名密钥。');
  if(secret){
    const encrypted=await encryptCredential(env,secret);
    await db.batch([q(db,'INSERT INTO merchants(pid,secret) VALUES(?,?)',pid,encrypted),q(db,'UPDATE settings SET mid=(SELECT MAX(id) FROM merchants),ratio=?,channel=? WHERE id=1',ratio,data.channel)]);
  }else await q(db,'UPDATE settings SET ratio=?,channel=? WHERE id=1',ratio,data.channel).run();
  return json({ok:true});
}
async function loadMerchant(env,id){
  const row=await q(env.DB,'SELECT * FROM merchants WHERE id=?',id).first();
  if(!row) problem(503,'管理员尚未配置支付商户。');
  return {pid:row.pid,secret:await encryptCredential(env,row.secret,true)};
}
async function createRecharge(env,user,data) {
  const cfg=await settingsView(env.DB),yuan=intField(data.yuan,1,10000,'充值金额');
  if(!cfg.ratio || !cfg.mid) problem(503,'充值尚未开放。');
  const merchant=await loadMerchant(env,cfg.mid),id=crypto.randomUUID();
  await q(env.DB,'INSERT INTO orders(id,uid,mid,channel,cents,points) VALUES(?,?,?,?,?,?)',id,user.id,cfg.mid,cfg.channel,yuan*100,yuan*cfg.ratio).run();
  const order=await payCall('/mapi.php',{pid:merchant.pid,out_trade_no:id,type:cfg.channel,name:'字幕配音点数',money:yuan.toFixed(2),notify_url:siteOrigin+'/api/payment/notify',return_url:siteOrigin+'/account?order='+id},merchant.secret);
  const next=new URL(order.payurl);
  if(next.origin!==payOrigin) problem(502,'支付网关未返回有效收银台地址。');
  return json({url:next.href});
}
async function settleOrder(env,order,merchant) {
  if(order.paid) return true;
  const result=await payCall('/api.php?act=order',{pid:merchant.pid,out_trade_no:order.id},merchant.secret);
  if(String(result.pid)!==merchant.pid || result.out_trade_no!==order.id || !/^\d{1,8}(\.\d{1,2})?$/.test(String(result.money)) || Math.round(Number(result.money)*100)!==order.cents)
    problem(409,'支付订单信息不一致。');
  if(Number(result.status)!==1) return false;
  await q(env.DB,'UPDATE orders SET paid=1 WHERE id=? AND paid=0',order.id).run();
  return true;
}
async function paymentNotify(request,env) {
  const params=new URL(request.url).searchParams;
  if(request.method==='POST') for(const [k,v] of new URLSearchParams(await request.text())) params.append(k,v);
  for(const k of params.keys()) if(params.getAll(k).length!==1) problem(400,'重复参数。');
  const o=await q(env.DB,'SELECT * FROM orders WHERE id=?',params.get('out_trade_no')||'').first();
  if(!o) problem(404,'未知订单。');
  const m=await loadMerchant(env,o.mid), p=Object.fromEntries(params);
  if(!p.sign || p.pid!==m.pid || p.trade_status!=='TRADE_SUCCESS' || p.sign.toLowerCase()!==await paySign(p,m.secret)) problem(403,'回调验证失败。');
  if(!await settleOrder(env,o,m)) problem(409,'等待网关确认。');
  return new Response('success');
}

export {encryptCredential,settingsView,saveSettings,createRecharge,settleOrder,loadMerchant,paymentNotify};
