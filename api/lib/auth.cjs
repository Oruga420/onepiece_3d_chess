const crypto = require('node:crypto');
const SESSION_MS = 12 * 60 * 60 * 1000;
function equal(a,b) { const x=Buffer.from(String(a)), y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function sign(data,secret) { return crypto.createHmac('sha256',secret).update(data).digest('base64url'); }
function issue(secret, now=Date.now()) { const data=Buffer.from(JSON.stringify({id:crypto.randomUUID(),csrf:crypto.randomBytes(24).toString('hex'),exp:now+SESSION_MS})).toString('base64url'); return `${data}.${sign(data,secret)}`; }
function verify(token,secret,now=Date.now()) { try { const [data,sig,...rest]=String(token).split('.'); if(rest.length || !equal(sig,sign(data,secret))) return null; const value=JSON.parse(Buffer.from(data,'base64url')); return typeof value.id==='string' && typeof value.csrf==='string' && Number.isFinite(value.exp) && value.exp>now && value.exp<=now+SESSION_MS ? value:null; } catch { return null; } }
module.exports={equal,issue,verify,SESSION_MS};
