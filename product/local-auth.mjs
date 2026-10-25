import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
const sha=value=>createHash('sha256').update(value).digest('hex');
const cookieName=secure=>secure?'__Host-mail-session':'mail-local-session';
export async function passwordHash(password){
  if(typeof password!=='string'||password.length<12||password.length>512)throw Error('password_requires_12_characters');
  const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex');
}
export async function openLocalAuth(db,config,secrets,{clock=Date.now}={}){
  const secure=new URL(config.origin).protocol==='https:';
  const stored=secrets('MAIL_PASSWORD_HASH');
  if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored))throw Error('product_password_hash_invalid');
  await db.exec(`CREATE TABLE IF NOT EXISTS product_sessions(key TEXT PRIMARY KEY,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS product_login_attempts(key TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS product_login_times ON product_login_attempts(at);`);
  const identity={authenticated:true,subject:config.owner.id,email:config.owner.email};
  const cookie=(value,age)=>`${cookieName(secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`;
  const token=request=>(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName(secure)+'='))?.split('=')[1]||'';
  const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store',...headers}});
  async function session(request){
    const given=token(request);if(!/^[\w-]{43}$/.test(given))return null;
    const row=await db.prepare('SELECT expires FROM product_sessions WHERE key=?').bind(sha(given)).first();
    return row&&row.expires>clock()?identity:null;
  }
  async function route(request,{client='local'}={}){
    const path=new URL(request.url).pathname;
    if(path==='/api/logout'&&request.method==='POST'){
      await db.prepare('DELETE FROM product_sessions WHERE key=?').bind(sha(token(request))).run();
      return json({ok:true,logout_url:'/'},200,{'set-cookie':cookie('',0)});
    }
    if(path!=='/api/login'||request.method!=='POST')return null;
    await db.prepare('DELETE FROM product_login_attempts WHERE at<?').bind(clock()-900000).run();
    const key=sha(String(client)),total=(await db.prepare('SELECT COUNT(*) n FROM product_login_attempts').first()).n;
    const local=(await db.prepare('SELECT COUNT(*) n FROM product_login_attempts WHERE key=?').bind(key).first()).n;
    if(total>=30||local>=5)return json({error:'尝试次数过多，请稍后再试。'},429);
    const input=await request.json().catch(()=>({}));
    const given=typeof input.password==='string'&&input.password.length<=512?input.password:'';
    const [salt,expected]=stored.split(':');const actual=await scrypt(given,salt,64);
    if(!timingSafeEqual(actual,Buffer.from(expected,'hex'))){
      await db.prepare('INSERT INTO product_login_attempts VALUES(?,?)').bind(key,clock()).run();
      return json({error:'密码错误。'},401);
    }
    const value=randomBytes(32).toString('base64url'),age=30*86400;
    await db.prepare('DELETE FROM product_sessions WHERE expires<=?').bind(clock()).run();
    await db.prepare('INSERT INTO product_sessions VALUES(?,?)').bind(sha(value),clock()+age*1000).run();
    return json({ok:true},200,{'set-cookie':cookie(value,age)});
  }
  return {session,route};
}
