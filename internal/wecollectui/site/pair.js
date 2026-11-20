'use strict';

// Use the company session only in its own HTTPS window.
const companyURL = new URL(el('company').href);
let peer = null;
let peerReady = false;
let pendingRecord = null;
let pairProject = '';
const confirmed = new Map();
const tooLarge = new Map();
let deadline;
let pairTimer;

function disconnectPeer(message = '') {
  if (peer && !peer.closed) peer.postMessage({type:'end'}, companyURL.origin);
  clearTimeout(deadline);
  clearInterval(pairTimer);
  peer = null; peerReady = false; pendingRecord = null;
  confirmed.clear(); tooLarge.clear();
  el('pairStatus').textContent = message;
  el('unpair').hidden = true;
  el('pair').disabled = false;
  el('syncProject').disabled = false;
}

function offerRecords() {
  if (!peer || !peerReady || pendingRecord || !activeScope) return;
  for (const record of records.values()) {
    if (confirmed.get(record.id) === record.version || tooLarge.get(record.id) === record.version) continue;
    if (new Blob([record.content]).size > 1024 * 1024) {
      tooLarge.set(record.id, record.version);
      continue;
    }
    tooLarge.delete(record.id);
    pendingRecord = record;
    peer.postMessage({type:'record', title:record.title, content:record.content, id:record.id}, companyURL.origin);
    deadline = setTimeout(() => disconnectPeer('接收端未返回回执，已暂停。重新连接可重试。'), 30000);
    return;
  }
  render();
  const current = [...records.values()];
  const count = current.filter(r => confirmed.get(r.id) === r.version).length;
  const oversize = current.filter(r => tooLarge.get(r.id) === r.version).length;
  el('pairStatus').textContent = '公司已确认 ' + count + ' 份会话' + (oversize ? '，另有 ' + oversize + ' 份正文超过接收端 1 MiB 上限，已保留在本机。' : '。');
}

function connectPeer() {
  pairProject = el('syncProject').value.trim();
  if (!pairProject || !activeScope) {el('pairStatus').textContent = '请填写要归档到的项目名。';return;}
  const url = new URL(companyURL);
  url.searchParams.set('desktop-sync','1');
  url.hash = new URLSearchParams({desktop:location.origin}).toString();
  peer = window.open(url.href, '_blank');
  if (!peer) {disconnectPeer('请允许打开公司工作台窗口。');return;}
  el('pair').disabled = true;
  el('syncProject').disabled = true;
  el('unpair').hidden = false;
  el('pairStatus').textContent = '等待公司工作台显示接收账号并确认。';
  deadline = setTimeout(() => disconnectPeer('未连接。请确认公司工作台已部署支持桌面同步的版本。'), 45000);
  pairTimer = setInterval(() => {
    if (peer?.closed) disconnectPeer('公司窗口已关闭，同步已停止。');
  }, 1000);
}

window.addEventListener('message', async event => {
  if (!peer || event.source !== peer || event.origin !== companyURL.origin || !activeScope) return;
  const data = event.data || {};
  if (data.type === 'ready') {
    clearTimeout(deadline);
    peer.postMessage({type:'scope', project:pairProject, agent:activeScope.agent, group:activeScope.group}, companyURL.origin);
  } else if (data.type === 'accepted') {
    peerReady = true;
    offerRecords();
  } else if (data.type === 'ack' && pendingRecord?.id === data.id) {
    const record = pendingRecord;
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(record.content));
    if (pendingRecord !== record) return;
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
    if (hash !== data.hash) {disconnectPeer('回执校验失败，同步已暂停。');return;}
    clearTimeout(deadline);
    record.archivedVersion = record.version;
    confirmed.set(record.id,record.version); pendingRecord = null;
    offerRecords();
  } else if (data.type === 'stopped') {
    disconnectPeer(data.reason || '公司端已暂停同步。');
  }
});
el('pair').onclick = connectPeer;
el('unpair').onclick = () => disconnectPeer('同步已断开。');
window.addEventListener('pagehide', () => disconnectPeer());

function initReceiver() {
  if (!new URLSearchParams(location.search).has('desktop-sync') || localLauncher) return;
  const sender = window.opener;
  const origin = new URLSearchParams(location.hash.slice(1)).get('desktop');
  for (const section of document.querySelectorAll('main > section')) section.hidden = true;
  el('receiver').hidden = false;
  if (!sender || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '')) {
    el('peerStatus').textContent = '请从 WeCollect 桌面端连接公司工作台。';return;
  }
  const post = data => sender.postMessage(data, origin);
  let scope, member, active = false, busy = false, ended = false, aborter;
  function stop(reason) {
    ended = true; active = false; aborter?.abort();
    el('allowPeer').disabled = true; el('stopPeer').hidden = true;
    el('peerStatus').textContent = reason; post({type:'stopped',reason});
  }
  async function showIdentity() {
    try {
      const who = await identity();
      if (ended || active) return;
      member = who.id;
      el('peerLogin').hidden = true;
      el('peerStatus').textContent = '接收账号：' + who.name + '。请确认此范围只含需要归档的非网关工作记录。';
      el('allowPeer').disabled = false;
    } catch (error) {
      if (ended || active) return;
      member = null; el('allowPeer').disabled = true;
      el('peerStatus').textContent = '请先登录公司工作台，登录后回到此窗口。';
      el('peerLogin').hidden = false;
    }
  }
  window.addEventListener('focus', () => {if (scope && !active && !ended) void showIdentity();});
  window.addEventListener('message', async event => {
    if (event.source !== sender || event.origin !== origin || ended) return;
    const d = event.data || {};
    if (d.type === 'end') {stop('桌面端已断开。');return;}
    if (d.type === 'scope' && !scope) {
      scope = {agent:d.agent,project:d.project};
      el('peerScope').textContent = d.agent + ' · ' + d.group + ' → ' + d.project + '。将已有、新增及更新的会话正文提交到 ' + location.host + '。';
      await showIdentity();
    }
    if (d.type !== 'record' || !active || busy) return;
    busy = true;
    try {
      const who = await identity();
      if (!active) return;
      if (who.id !== member) throw Error('接收账号已改变');
      const response = await fetch(new URL('desktop-exports',api), {method:'POST',signal:aborter.signal,
        headers:{'Content-Type':'application/json','X-CSRF-Token':who.csrf_token},
        body:JSON.stringify({...scope,owner:member,title:d.title,content:d.content})});
      if (!response.ok) throw Error('归档失败（HTTP ' + response.status + '）');
      const receipt = await response.json();
      if (!receipt.id || !receipt.sha256) throw Error('归档回执无效');
      if (active) post({type:'ack',id:d.id,hash:receipt.sha256});
    } catch (error) {if (active) stop(error.message + '，同步已暂停。');}
    finally {busy = false;}
  });
  el('allowPeer').onclick = () => {
    if (!scope || !member || ended) return;
    active = true; aborter = new AbortController();
    el('allowPeer').disabled = true; el('stopPeer').hidden = false;
    el('peerStatus').textContent = '正在接收已确认工作区的会话。';
    post({type:'accepted'});
  };
  el('stopPeer').onclick = () => stop('同步已暂停。');
  window.addEventListener('pagehide', () => stop('公司窗口已关闭。'));
  post({type:'ready'});
}

initNative();
initReceiver();
