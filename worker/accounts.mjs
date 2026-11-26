const textBytes = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
const randomHex = size => hex(crypto.getRandomValues(new Uint8Array(size)));
const sha256 = text => crypto.subtle.digest('SHA-256',textBytes.encode(text)).then(hex);
const q = (db,sql,...args) => db.prepare(sql).bind(...args);
const json = (data,status=200,extra={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store',...extra}});
function problem(status,message) { throw Object.assign(new Error(message),{status}); }
async function verifier(password,salt) {
  const key=await crypto.subtle.importKey('raw',textBytes.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:textBytes.encode(salt),iterations:100000},key,256));
}
const schema=[
  'CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, uid INTEGER NOT NULL, expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS attempts(bucket TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY, ratio INTEGER NOT NULL DEFAULT 0, rate INTEGER NOT NULL DEFAULT 0, mid INTEGER NOT NULL DEFAULT 0, channel TEXT NOT NULL DEFAULT \'alipay\')',
  'INSERT OR IGNORE INTO settings(id) VALUES(1)',
  'CREATE TABLE IF NOT EXISTS merchants(id INTEGER PRIMARY KEY, pid TEXT NOT NULL, secret TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, uid INTEGER NOT NULL, mid INTEGER NOT NULL, channel TEXT NOT NULL, cents INTEGER NOT NULL, points INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT(unixepoch()))',
  'CREATE INDEX IF NOT EXISTS user_orders ON orders(uid,created)',
  'CREATE TABLE IF NOT EXISTS charges(id TEXT PRIMARY KEY, uid INTEGER NOT NULL, points INTEGER NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL DEFAULT(unixepoch()))',
  'CREATE INDEX IF NOT EXISTS user_charges ON charges(uid,state)'
];
let ready;
async function setupDB(db,env) {
  if (!ready) ready=(async()=>{
    await db.batch(schema.map(s=>db.prepare(s)));
    const seed=env.ADMIN_VERIFIER || '__ADMIN_VERIFIER__';
    if(!/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(seed)) throw new Error('admin verifier missing');
    const [salt,hash]=seed.split(':');
    await q(db,'INSERT OR IGNORE INTO users(name,salt,hash,admin) VALUES(?,?,?,1)','unlil',salt,hash).run();
  })().catch(err=>{ready=undefined;throw err});
  return ready;
}
function sessionToken(request){return /(?:^|;\s*)__Host-srtvoice=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('Cookie')||'')?.[1]}
async function sessionUser(db,request) {
  const token=sessionToken(request);
  return token && q(db,'SELECT u.id,u.name,u.admin FROM sessions s JOIN users u ON u.id=s.uid WHERE token=? AND expires>unixepoch()',await sha256(token)).first();
}
async function login(db,request,data,register) {
  const name=String(data.name||'').normalize('NFKC').trim().toLowerCase();
  const password=data.password;
  if(!/^[\p{L}\d_-]{2,32}$/u.test(name) || typeof password!=='string' || password.length<8 || password.length>128)
    problem(400,'用户名限 2–32 个字母、汉字、数字、下划线或短横线，密码限 8–128 位。');
  const now=Math.floor(Date.now()/1000), ip=request.headers.get('CF-Connecting-IP')||'local';
  const bucket=await sha256((register?'register:':'login:')+ip);
  const attempts=await q(db,'INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=CASE WHEN until<=? THEN 1 ELSE n+1 END, until=CASE WHEN until<=? THEN excluded.until ELSE until END RETURNING n',bucket,now+600,now,now).first();
  if(attempts.n>(register?10:40)) problem(429,'尝试次数过多，请稍后重试。');
  let user=await q(db,'SELECT * FROM users WHERE name=?',name).first();
  if(register){
    if(name==='unlil'||user) problem(409,'用户名已被使用。');
    const salt=randomHex(16), hash=await verifier(password,salt);
    user=await q(db,'INSERT INTO users(name,salt,hash) VALUES(?,?,?) ON CONFLICT(name) DO NOTHING RETURNING id',name,salt,hash).first();
    if(!user) problem(409,'用户名已被使用。');
  } else {
    const hash=await verifier(password,user?.salt || 'unregistered-account');
    if(!user || hash!==user.hash) problem(401,'用户名或密码不正确。');
  }
  const token=randomHex(32);
  await db.batch([q(db,'DELETE FROM sessions WHERE expires<=?',now),q(db,'DELETE FROM attempts WHERE until<=?',now),q(db,'INSERT INTO sessions VALUES(?,?,?)',await sha256(token),user.id,now+604800)]);
  return json({ok:true},200,{'Set-Cookie':'__Host-srtvoice='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800'});
}
const balanceSQL="(SELECT COALESCE(sum(points),0) FROM orders WHERE uid=? AND paid=1) - (SELECT COALESCE(sum(points),0) FROM charges WHERE uid=? AND (state='done' OR (state='held' AND created>unixepoch()-600)))";
async function getBalance(db,uid){return (await q(db,'SELECT '+balanceSQL+' AS n',uid,uid).first()).n}
export {setupDB,sessionUser,login,json,problem,q,getBalance,sessionToken,sha256,textBytes,hex};
