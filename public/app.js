const $ = id => document.getElementById(id);
const usd = value => new Intl.NumberFormat('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).format(value);
let initialized = false;
let busy = false;
let current = null;
let dirty = false;
function message(text, error=false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
async function request(path, body) {
  const response = await fetch(path, {method:body ? 'POST':'GET', headers:body ? {'Content-Type':'application/json'}:{}, body:body ? JSON.stringify(body):undefined, cache:'no-store', signal:AbortSignal.timeout(45000)});
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; }
  return data;
}
function directions() {
  for (let i=1;i<=2;i++) {
    const target = Number($('p'+i).value);
    $('d'+i).textContent = current && target > 0 ? (target >= current ? 'At or above' : 'At or below') + ' $' + usd(target) : 'Enter your target';
  }
}
async function refresh(force=false) {
  if (busy) return;
  try {
    const data = await request('/api/state');
    $('login').hidden = true; $('desk').hidden = false;
    current = data.quote?.price;
    $('price').textContent = current ? '$'+usd(current) : '—';
    const stamp = data.quote ? new Date(data.quote.updatedAt).toLocaleString() : '';
    $('feed').textContent = data.fresh ? 'Updated '+stamp : (data.feedError || 'Waiting for a fresh quote…');
    $('email').textContent = data.emailReady ? data.email : 'Email needs setup on the server.';
    $('save').disabled = !data.fresh || !data.emailReady;
    $('test').disabled = !data.emailReady;
    data.levels.forEach((level,index) => {
      const i = index+1;
      if (!initialized || force) $('p'+i).value = level.target;
      $('s'+i).textContent = ({armed:'Armed',pending:'Email pending',sent:'Email sent',paused:'Paused',failed:'Email failed'})[level.status];
      if (!dirty || force) $('d'+i).textContent = (level.direction === 'up' ? 'At or above' : 'At or below')+' $'+usd(level.target);
    });
    if (!data.levels.length) directions();
    initialized = true;
    if (data.mailError) message(data.mailError, true);
  } catch (error) {
    if (error.status === 401) { $('login').hidden = false; $('desk').hidden = true; }
    else { $('save').disabled = true; $('feed').textContent = 'Server unreachable. Monitoring cannot be confirmed.'; message('Cannot reach your server. Check that it is running.',true); }
  }
}
async function action(path, body, success) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b => b.disabled=true);
  let succeeded = false;
  try { await request(path, body); succeeded = true; if(path === '/api/arm') dirty = false; message(success); }
  catch (error) { message(error.message,true); }
  finally { busy=false; buttons.forEach(b => b.disabled=false); await refresh(succeeded && path === '/api/arm'); }
}
$('login-form').addEventListener('submit',async e => {e.preventDefault(); await action('/api/login',{password:$('password').value},''); $('password').value='';});
$('targets').addEventListener('submit',e => {e.preventDefault(); action('/api/arm',{prices:[$('p1').value,$('p2').value]},'Both targets saved. One email per target.');});
$('pause').addEventListener('click',()=>action('/api/pause',{},'Alerts paused. Pending emails cancelled.'));
$('test').addEventListener('click',()=>action('/api/test-email',{},'Test email accepted by your mail server. Check your inbox and spam folder.'));
['p1','p2'].forEach(id=>$(id).addEventListener('input',()=>{dirty=true; directions();}));
refresh(); setInterval(refresh,10000); document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
