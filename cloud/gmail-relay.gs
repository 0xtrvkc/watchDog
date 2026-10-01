/** WatchDog Gmail relay. Configure Script Properties; never put real secrets in Git. */
function reply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function authorizeMail() {
  // Run once in the editor to grant the mail permission, without sending a message.
  MailApp.getRemainingDailyQuota();
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 8192) return reply_({ok:false,error:'Invalid relay request.'});
    var data = JSON.parse(raw);
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('RELAY_SECRET') || '';
    var to = props.getProperty('MAIL_TO') || '';
    if (secret.length < 32 || !same_(data.secret,secret)) return reply_({ok:false,error:'Relay secret does not match.'});
    if (!to || data.to !== to) return reply_({ok:false,error:'Relay recipient does not match.'});
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(data.id || '') || typeof data.subject !== 'string' || typeof data.text !== 'string' || data.subject.length > 160 || data.text.length > 4096)
      return reply_({ok:false,error:'Invalid email contents.'});
    if (!lock.tryLock(1000)) return reply_({ok:false,error:'Relay busy. Try again later.'});
    var key = 'sent_' + data.id;
    if (props.getProperty(key)) return reply_({ok:true,duplicate:true});
    if (MailApp.getRemainingDailyQuota() < 1) return reply_({ok:false,error:'Google mail quota exhausted.'});
    MailApp.sendEmail({to:to,subject:data.subject,body:data.text,name:'WatchDog'});
    props.setProperty(key,String(Date.now()));
    // Keep a bounded seven-day retry ledger. MailApp itself has no exactly-once transaction.
    var sent = Object.keys(props.getProperties()).filter(function(k){return k.indexOf('sent_')===0;})
      .map(function(k){return {key:k,time:Number(props.getProperty(k))};})
      .sort(function(a,b){return b.time-a.time;});
    sent.forEach(function(item,index){if(index>=200 || Date.now()-item.time>7*86400000)props.deleteProperty(item.key);});
    return reply_({ok:true});
  } catch(error) {
    return reply_({ok:false,error:'Relay failed. Check Google permissions and sending quota.'});
  } finally {
    if(lock.hasLock())lock.releaseLock();
  }
}

function same_(a,b) {
  a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;
  var diff=0;for(var i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
