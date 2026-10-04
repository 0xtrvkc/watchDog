import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker,{mutate,arm,pause,observe,prices,runMonitor} from './worker.js';

function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_state.sql',import.meta.url),'utf8'));
  return {
    prepare(sql) {
      let values=[];const statement=db.prepare(sql);
      return {bind(...args){values=args;return this;},
        async first(){return statement.get(...values)||null;},
        async run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes)}};}};
    },
    close(){db.close();},
  };
}
function environment() {
  return {DB:database(),APP_PASSWORD:'a-private-password-for-test-only',MAIL_TO:'owner@example.com',
    EMAIL_WEBHOOK_SECRET:'a-separate-webhook-secret-long-enough',
    EMAIL_WEBHOOK_URL:'https://script.google.com/macros/s/mock/exec',
    ASSETS:{async fetch(){return new Response('<html>Static app</html>',{headers:{'Content-Type':'text/html'}});}}};
}
function quote(price,now=Date.now()){return {price,timestamp:now,updatedAt:new Date(now).toISOString()};}
async function snapshot(env){return JSON.parse((await env.DB.prepare('SELECT payload FROM monitor WHERE id=1').first()).payload);}
function goldResponse(price,now,cache=30){return Response.json({symbol:'XAU',currency:'USD',price,updatedAt:new Date(now).toISOString()},{headers:{'Cache-Control':`public, max-age=${cache}`}});}

test('up/down overshoots, exact touch, one-shot state and invalid targets',async()=>{
  const env=environment();const now=Date.now();
  await mutate(env.DB,s=>{observe(s,quote(4100,now-1000),now);arm(s,[4150,4050],now);});
  await mutate(env.DB,s=>observe(s,quote(4150,now),now));
  await mutate(env.DB,s=>observe(s,quote(4200,now+1000),now+1000));
  let state=await snapshot(env);assert.equal(state.pending.length,1);
  await mutate(env.DB,s=>observe(s,quote(4040,now+2000),now+2000));
  state=await snapshot(env);assert.equal(state.pending.length,2);
  for(const v of [[1],[1,1],[true,2],[null,3],['nan',2],[-1,2]])assert.throws(()=>prices(v));
  env.DB.close();
});
test('stale and replayed quotes cannot trigger; pause cancels pending',async()=>{
  const env=environment(),now=Date.now();
  await mutate(env.DB,s=>{observe(s,quote(4100,now),now);arm(s,[4150,4050],now);});
  await assert.rejects(mutate(env.DB,s=>observe(s,quote(4300,now-300000),now)));
  await mutate(env.DB,s=>observe(s,quote(4300,now-1000),now));
  assert.equal((await snapshot(env)).pending.length,0);
  await mutate(env.DB,s=>{observe(s,quote(4300,now+1000),now+1000);pause(s);});
  assert.equal((await snapshot(env)).pending.length,0);env.DB.close();
});
test('scheduler fetches once and sends only crossed targets; subsequent checks do not resend',async()=>{
  const env=environment(),now=Date.now();const calls=[];
  await mutate(env.DB,s=>{observe(s,quote(4100,now-1000),now);arm(s,[4150,4050],now);});
  const fetcher=async(url,options)=>{calls.push(url);return url.includes('gold-api')?goldResponse(4160,now):Response.json({ok:true});};
  await runMonitor(env,{fetcher,now});
  assert.equal((await snapshot(env)).levels[0].status,'sent');
  await runMonitor(env,{fetcher,now:now+60000});
  assert.equal(calls.filter(x=>x.includes('script.google')).length,1);env.DB.close();
});
test('failed delivery persists and retries with a stable id and payload',async()=>{
  const env=environment(),now=Date.now();const bodies=[];let fail=true;
  await mutate(env.DB,s=>{observe(s,quote(4100,now-1000),now);arm(s,[4150,4050],now);});
  const fetcher=async(url,options)=>{
    if(url.includes('gold-api'))return goldResponse(4160,now);
    bodies.push(JSON.parse(options.body));return Response.json({ok:!fail});
  };
  await runMonitor(env,{fetcher,now});
  assert.equal((await snapshot(env)).pending[0].attempts,1);
  fail=false;await runMonitor(env,{fetcher,now:now+60000});
  assert.deepEqual(bodies[0],bodies[1]);assert.equal((await snapshot(env)).levels[0].status,'sent');env.DB.close();
});
test('parallel Cron Trigger invocations are leased; provider caching and retry-after are honoured',async()=>{
  const env=environment(),now=Date.now();let calls=0;
  const fetcher=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return goldResponse(4100,now,300);};
  await Promise.all([runMonitor(env,{fetcher,now}),runMonitor(env,{fetcher,now})]);
  await runMonitor(env,{fetcher,now:now+60000});assert.equal(calls,1);
  await mutate(env.DB,s=>{s.nextFetchAt=0;});
  await runMonitor(env,{now:now+120000,fetcher:async()=>new Response('',{status:429,headers:{'Retry-After':'600'}})});
  assert.ok((await snapshot(env)).nextFetchAt>=now+720000);env.DB.close();
});
test('optimistic updates preserve concurrent state mutations',async()=>{
  const env=environment();
  await Promise.all([mutate(env.DB,s=>{s.mailError='test';}),mutate(env.DB,s=>{s.feedError='test2';})]);
  const state=await snapshot(env);assert.equal(state.mailError,'test');assert.equal(state.feedError,'test2');env.DB.close();
});
test('cloud API requires session and same-origin writes; secrets are not returned',async()=>{
  const env=environment();const base='https://watchdog.example';
  assert.equal((await worker.fetch(new Request(base+'/api/state'),env)).status,401);
  const post=(path,body,cookie,origin=base)=>new Request(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  assert.equal((await worker.fetch(post('/api/login',{password:env.APP_PASSWORD},null,'https://other.example'),env)).status,403);
  const login=await worker.fetch(post('/api/login',{password:env.APP_PASSWORD}),env);
  assert.equal(login.status,200);const cookie=login.headers.get('Set-Cookie').split(';')[0];
  assert.ok(login.headers.get('Set-Cookie').includes('Secure'));
  const response=await worker.fetch(new Request(base+'/api/state',{headers:{Cookie:cookie}}),env);
  const data=await response.json();assert.equal(data.monitor.mode,'cloud');assert.equal(data.EMAIL_WEBHOOK_SECRET,undefined);
  assert.equal(data.loginNext,undefined);assert.equal(data.pending,undefined);
  const staticResponse=await worker.fetch(new Request(base+'/'),env);
  assert.ok(staticResponse.headers.get('Content-Security-Policy'));env.DB.close();
});
test('Gmail relay restricts recipient, authenticates and deduplicates retries',()=>{
  const values={RELAY_SECRET:'a-relay-secret-which-is-at-least-32-characters',MAIL_TO:'owner@example.com'};
  const sent=[];let locked=false;
  const props={getProperty:k=>values[k]||null,setProperty:(k,v)=>{values[k]=v;},getProperties:()=>({...values}),deleteProperty:k=>{delete values[k];}};
  const context={PropertiesService:{getScriptProperties:()=>props},
    LockService:{getScriptLock:()=>({tryLock:()=>{locked=true;return true;},hasLock:()=>locked,releaseLock:()=>{locked=false;}})},
    MailApp:{getRemainingDailyQuota:()=>100,sendEmail:mail=>sent.push(mail)},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})}};
  vm.createContext(context);vm.runInContext(readFileSync(new URL('./gmail-relay.gs',import.meta.url),'utf8'),context);
  const event={id:'abcdefgh-1234-1234',to:values.MAIL_TO,secret:values.RELAY_SECRET,subject:'Gold alert',text:'Target crossed.'};
  const call=data=>context.doPost({postData:{contents:JSON.stringify(data)}});
  assert.equal(call({...event,secret:'bad'}).ok,false);
  assert.equal(call({...event,to:'other@example.com'}).ok,false);
  assert.equal(call(event).ok,true);assert.equal(call(event).duplicate,true);assert.equal(sent.length,1);
});

test('optional Jev route requires the existing session and never changes alert state when unconfigured',async()=>{
  const env=environment(),base='https://watchdog.example';
  const request=cookie=>new Request(base+'/api/jev',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({input:{instruction:'above 4200 and below 4000'}})});
  assert.equal((await worker.fetch(request(),env)).status,401);
  const login=await worker.fetch(new Request(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:env.APP_PASSWORD})}),env);
  const cookie=login.headers.get('Set-Cookie').split(';')[0],before=JSON.stringify(await snapshot(env));
  const result=await worker.fetch(request(cookie),env);assert.equal(result.status,503);
  assert.equal(JSON.stringify(await snapshot(env)),before);assert.ok(!(await result.text()).includes(env.APP_PASSWORD));env.DB.close();
});
