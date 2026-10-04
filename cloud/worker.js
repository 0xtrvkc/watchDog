import {handleJev} from '../jev/worker.mjs';
const GOLD_API = 'https://api.gold-api.com/price/XAU';
const encoder = new TextEncoder();
const defaults = () => ({quote:null,levels:[],pending:[],feedError:'',mailError:'',lastSent:null,
  lastCheckAt:0,lastRunAt:0,nextFetchAt:0,failures:0,loginNext:0,testNext:0});

function fail(message, status=400) { const e=new Error(message); e.status=status; throw e; }
function same(a,b) { a=String(a); b=String(b); if(a.length!==b.length)return false; let n=0; for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i); return n===0; }
export function fresh(quote, now=Date.now()) { return !!quote && now-quote.timestamp>=-10000 && now-quote.timestamp<=120000; }
export function prices(values) {
  if(!Array.isArray(values)||values.length!==2)fail('Enter exactly two prices.');
  const result=values.map(v=> {
    if(typeof v==='boolean'||v===null||String(v).trim()==='')fail('Enter a positive price.');
    const p=Number(v); if(!Number.isFinite(p)||p<=0||p>1000000)fail('Enter a price between 0 and 1,000,000 USD.'); return p;
  });
  if(result[0]===result[1])fail('Use two different prices.'); return result;
}
async function load(db) {
  const row=await db.prepare('SELECT payload, version FROM monitor WHERE id=1').first();
  if(!row)fail('Database setup required. Apply the D1 migration.',503);
  return {state:{...defaults(),...JSON.parse(row.payload)},version:row.version};
}
export async function mutate(db, change) {
  for(let i=0;i<8;i++) {
    const {state,version}=await load(db); change(state);
    const r=await db.prepare('UPDATE monitor SET payload=?, version=version+1 WHERE id=1 AND version=?').bind(JSON.stringify(state),version).run();
    if(r.meta.changes===1)return state;
  }
  fail('Another update is in progress. Try again.',409);
}
export function arm(state, values, now=Date.now()) {
  const targets=prices(values);
  if(!fresh(state.quote,now)||state.feedError)fail('Wait for the next fresh cloud price check.');
  if(state.pending.length)fail('An email is pending. Pause before setting new targets.');
  if(targets.includes(state.quote.price))fail('Choose targets above or below the current price.');
  state.levels=targets.map(target=>({id:crypto.randomUUID(),target,direction:target>state.quote.price?'up':'down',status:'armed'}));
  state.mailError='';
}
export function observe(state, quote, now=Date.now()) {
  if(!fresh(quote,now))fail('No fresh quote: feed unavailable, stale, or market closed.');
  state.feedError='';
  if(state.quote && quote.timestamp<=state.quote.timestamp)return;
  state.quote=quote;
  for(const level of state.levels) {
    const reached=level.direction==='up'?quote.price>=level.target:quote.price<=level.target;
    if(level.status==='armed'&&reached) {
      level.status='pending'; level.hitAt=quote.updatedAt;
      state.pending.push({id:level.id,target:level.target,quote,attempts:0,nextTry:0,createdAt:now});
    }
  }
}
export function pause(state) {
  for(const level of state.levels)if(['armed','pending','failed'].includes(level.status))level.status='paused';
  state.pending=[];state.mailError='';
}
function emailReady(env) {
  return !!(env.EMAIL_WEBHOOK_URL?.startsWith('https://script.google.com/macros/s/') && env.EMAIL_WEBHOOK_URL.endsWith('/exec') &&
    env.EMAIL_WEBHOOK_SECRET?.length>=32 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.MAIL_TO||''));
}
async function signature(secret, value) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
async function authenticated(request,env) {
  const session=request.headers.get('Cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  if(!session)return false;
  const [expires,sig]=session.split('.');
  return Number(expires)>Date.now() && Number(expires)<=Date.now()+86401000 && same(sig,await signature(env.APP_PASSWORD,expires));
}
const securityHeaders={
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Referrer-Policy':'no-referrer',
};
function json(data,status=200,extra={}) {return Response.json(data,{status,headers:{...securityHeaders,...extra}});}

async function sendEmail(env,event,fetcher=fetch) {
  if(!emailReady(env))fail('Configure the Gmail relay secrets first.',503);
  const money=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const payload=event.payload || {
    id:event.id,to:env.MAIL_TO,
    subject:event.target?`Gold alert: $${money(event.target)} reached`:'WatchDog: email test',
    text:event.target?`Your gold target $${money(event.target)} was reached or crossed.\nObserved XAU/USD: $${money(event.quote.price)} per troy ounce.\nFeed time (UTC): ${event.quote.updatedAt}\nSource: gold-api.com. This target is now disarmed.\nCloud checks are about one minute apart; broker prices may differ.`:
      'Email is connected. Save your two prices in WatchDog to arm alerts.',
  };
  const response=await fetcher(env.EMAIL_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,secret:env.EMAIL_WEBHOOK_SECRET}),redirect:'follow',signal:AbortSignal.timeout(15000)});
  let result;
  try {result=await response.json();}catch {fail('Gmail relay did not return JSON. Check its deployment access.',503);}
  if(!response.ok||!result.ok)fail(result.error||'Gmail relay rejected the message.',503);
}

export async function runMonitor(env,{fetcher=fetch,now=Date.now()}={}) {
  const lease=crypto.randomUUID();
  const acquired=await env.DB.prepare('UPDATE monitor SET lease_until=?, lease_id=? WHERE id=1 AND lease_until<=?').bind(now+90000,lease,now).run();
  if(acquired.meta.changes!==1)return;
  try {
    await mutate(env.DB,s=>{s.lastRunAt=now;});
    let {state}=await load(env.DB);
    if(now>=state.nextFetchAt) {
      try {
        const response=await fetcher(GOLD_API,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
        if(!response.ok) {
          const error=new Error('Price provider unavailable.');
          const retry=response.headers.get('Retry-After');
          error.retryAt=retry && /^\d+$/.test(retry)?now+Number(retry)*1000:Date.parse(retry||'');
          throw error;
        }
        const data=await response.json();
        if(data.symbol!=='XAU'||data.currency!=='USD'||!Number.isFinite(data.price)||data.price<=0)throw new Error('Unexpected gold quote.');
        const quote={price:data.price,timestamp:Date.parse(data.updatedAt),updatedAt:data.updatedAt};
        if(!fresh(quote,now))throw new Error('Stale quote.');
        const age=response.headers.get('Cache-Control')?.match(/(?:^|,)\s*max-age=(\d+)/)?.[1];
        await mutate(env.DB,s=>{observe(s,quote,now);s.lastCheckAt=now;s.failures=0;s.nextFetchAt=now+Math.max(30000,Number(age||30)*1000);});
      } catch(error) {
        await mutate(env.DB,s=>{s.lastCheckAt=now;s.failures++;s.feedError='No fresh quote: feed unavailable, stale, or market closed.';
          s.nextFetchAt=Math.max(now+Math.min(900000,60000*2**Math.min(s.failures-1,4)),Number.isFinite(error.retryAt)?error.retryAt:0);});
      }
    }
    ({state}=await load(env.DB));
    for(const original of state.pending) {
      if(original.nextTry>now)continue;
      // Persist the exact recipient/content so configuration changes cannot redirect a retry.
      const claimed=await mutate(env.DB,s=>{
        const event=s.pending.find(p=>p.id===original.id);
        if(!event)return;
        if(!event.payload)event.payload={id:event.id,to:env.MAIL_TO,subject:`Gold alert: $${event.target.toFixed(2)} reached`,
          text:`Your gold target $${event.target.toFixed(2)} was reached or crossed.\nObserved XAU/USD: $${event.quote.price.toFixed(2)} per troy ounce.\nFeed time (UTC): ${event.quote.updatedAt}\nSource: gold-api.com. This target is now disarmed.\nCloud checks are about one minute apart; brief touches can be missed and broker prices may differ.`};
      });
      const event=claimed.pending.find(p=>p.id===original.id);if(!event)continue;
      try {
        if(now-event.createdAt>=21600000)throw new Error('Email retry window expired.');
        await sendEmail(env,event,fetcher);
        await mutate(env.DB,s=>{s.pending=s.pending.filter(p=>p.id!==event.id);const level=s.levels.find(l=>l.id===event.id);if(level?.status==='pending')level.status='sent';s.lastSent=new Date(now).toISOString();if(!s.pending.length)s.mailError='';});
      } catch(error) {
        await mutate(env.DB,s=>{
          const current=s.pending.find(p=>p.id===event.id);if(!current)return;
          current.attempts++;current.nextTry=now+Math.min(900000,60000*2**Math.min(current.attempts-1,4));
          s.mailError='Email failed; check the Gmail relay. Automatic retries are pending.';
          if(current.attempts>=10||now-current.createdAt>=21600000) {
            s.pending=s.pending.filter(p=>p.id!==event.id);
            const level=s.levels.find(l=>l.id===event.id);if(level)level.status='failed';
            s.mailError='Email failed. Fix the Gmail relay, test email, then save targets to rearm.';
          }
        });
      }
    }
  } finally {
    await env.DB.prepare('UPDATE monitor SET lease_until=0, lease_id=? WHERE id=1 AND lease_id=?').bind('',lease).run();
  }
}

export default {
  async fetch(request,env) {
    try {
      const url=new URL(request.url);
      if(!url.pathname.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
        const asset=await env.ASSETS.fetch(request);
        const result=new Response(asset.body,asset);for(const [key,value] of Object.entries(securityHeaders))result.headers.set(key,value);return result;
      }
      if(!env.APP_PASSWORD||env.APP_PASSWORD.length<16||env.APP_PASSWORD.startsWith('replace-'))fail('Configure APP_PASSWORD in Cloudflare secrets first.',503);
      if(url.pathname==='/api/jev') {
        if(!await authenticated(request,env))fail('Sign in first.',401);
        return handleJev(request,{...env,ALLOWED_ORIGINS:url.origin},{authenticated:true});
      }
      if(request.method==='GET'&&url.pathname==='/api/state') {
        if(!await authenticated(request,env))fail('Sign in to view your alerts.',401);
        const {state}=await load(env.DB);
        const {pending,loginNext,testNext,failures,nextFetchAt,...safe}=state;
        return json({...safe,fresh:fresh(state.quote)&&!state.feedError,emailReady:emailReady(env),email:env.MAIL_TO||'',monitor:{mode:'cloud',intervalSeconds:60,lastCheckAt:state.lastRunAt}});
      }
      if(request.method!=='POST')fail('Not found.',404);
      if(request.headers.get('Origin')!==url.origin)fail('Open the app at its configured address.',403);
      if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')fail('JSON required.',415);
      const text=await request.text();if(text.length>2048)fail('Invalid request size.',413);
      let body;try {body=JSON.parse(text);}catch {fail('Invalid JSON.');}
      if(!body||typeof body!=='object'||Array.isArray(body))fail('Invalid request.');
      if(url.pathname==='/api/login') {
        const now=Date.now();
        await mutate(env.DB,s=>{if(now<s.loginNext)fail('Wait two seconds and try again.',429);s.loginNext=now+2000;});
        if(!same(body.password||'',env.APP_PASSWORD))fail('Incorrect app password.',401);
        const expires=String(now+86400000);const sig=await signature(env.APP_PASSWORD,expires);
        return json({ok:true},200,{'Set-Cookie':`session=${expires}.${sig}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${url.protocol==='https:'?'; Secure':''}`});
      }
      if(!await authenticated(request,env))fail('Sign in first.',401);
      if(url.pathname==='/api/arm') {
        if(!emailReady(env))fail('Configure the Gmail relay first.');
        await mutate(env.DB,s=>arm(s,body.prices));
      } else if(url.pathname==='/api/pause')await mutate(env.DB,pause);
      else if(url.pathname==='/api/test-email') {
        const now=Date.now();await mutate(env.DB,s=>{if(now<s.testNext)fail('Wait one minute before another test.',429);s.testNext=now+60000;});
        await sendEmail(env,{id:crypto.randomUUID()});
      } else fail('Not found.',404);
      return json({ok:true});
    } catch(error) {
      return json({error:error.status?error.message:'Cloud setup error. Check the D1 migration and Worker settings.'},error.status||503);
    }
  },
  scheduled(_event,env,ctx) {ctx.waitUntil(runMonitor(env));},
};
