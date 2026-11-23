'use strict';
const el = id => document.getElementById(id);
const api = new URL('../api/', location.href);
const hosted = ['http:', 'https:'].includes(location.protocol);
const localLauncher = location.hostname==='127.0.0.1' && new URLSearchParams(location.search).get('local')==='1';
if(localLauncher){el('company').hidden=false;setInterval(()=>fetch('/alive').catch(()=>{}),30000);}
const limit = 1024 * 1024;
let folder, activeMember, syncing = false, scanning = false, revision = 0, controller;
let records = new Map();
const receipts = new Map();
let receiptOwner;
const picked = new Set();
const plain = name => /\.(txt|md|markdown)$/i.test(name);

function transcript(raw, agent) {
  const lines = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (agent === 'Codex' && r.type === 'session_meta' && r.payload?.model_provider === 'aiseat') {
      throw Error('此会话已标记为公司网关来源');
    }
    let m;
    switch(agent) {
      case 'Codex': if(r.type==='response_item' && r.payload?.type==='message') m=r.payload; break;
      case 'WorkBuddy': if(r.type==='message') m=r; break;
      case 'Cursor': if(r.message) m={role:r.role,content:r.message.content}; break;
      case 'Claude Code': if(['user','assistant'].includes(r.type)) m=r.message; break;
    }
    if (!m || !['assistant','user'].includes(m.role)) continue;
    const blocks = typeof m.content === 'string' ? [m.content] :
      (Array.isArray(m.content) ? m.content.filter(b => ['text','input_text','output_text'].includes(b?.type)).map(b => b.text) : []);
    let text = blocks.filter(x => typeof x === 'string' && x.trim()).join('\n');
    if (agent==='WorkBuddy' && m.role==='user') {
      const queries=Array.from(text.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g),x=>x[1]);
      text=queries.join('\n');
    }
    if (text) lines.push((m.role === 'user' ? '提问' : '回复') + '\n' + text);
  }
  if (!lines.length) throw Error('未找到可识别的提问或回复');
  return lines.join('\n\n');
}
function formats() {
  const jsonl = ['Codex','Claude Code','Cursor','WorkBuddy'].includes(el('agent').value);
  el('format').textContent = jsonl ? '接受 Markdown、TXT 或该工具的会话 JSONL。JSONL 只提取可见的提问和回复，跳过工具载荷、思考和附件。' : '接受 Markdown 或 TXT 工作记录。文件正文将原样预览和提交。';
  return jsonl;
}
function archiveState(text) {
  el('archiveState').textContent = text ? '本窗口公司归档 · ' + text : '本窗口公司归档未开启';
}

function reset() {
  archiveState('');
  revision++;
  controller?.abort();
  folder = undefined; activeMember = null; syncing = false;
  records = new Map(); receipts.clear(); picked.clear();
  el('toggle').textContent = '开启自动同步'; el('toggle').disabled = true;
  el('scope').textContent = '尚未选择文件夹'; el('sync').textContent = '尚未启用';
  el('exportStatus').textContent = '';
  formats(); render();
}
function matchingRecords() {
  const query = el('search').value.trim().toLowerCase();
  const range = weekRange(el('period').value, new Date());
  return [...records.values()].filter(record =>
    (!range || (record.modified >= range.start && record.modified < range.end)) &&
    (record.title + '\n' + record.content).toLowerCase().includes(query)
  ).sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title));
}

function updateSelection(matches) {
  for (const id of ['transfer', 'copy', 'daily', 'weekly', 'handoff', 'clearPicks']) el(id).disabled = !picked.size;
  el('selectMatches').disabled = !matches.some(record => !picked.has(record.title));
  el('selection').textContent = '筛选结果 ' + matches.length + ' 份 · 共勾选 ' + picked.size + ' 份';
}

function render() {
  const container = el('records');
  const expanded = new Set([...container.querySelectorAll('details[open]')].map(detail => detail.dataset.record));
  container.replaceChildren();
  const matches = matchingRecords();
  for (const r of matches) {
    const row = document.createElement('div'); row.className = 'record';
    const label = document.createElement('label'), check = document.createElement('input');
    check.type = 'checkbox'; check.checked = picked.has(r.title);
    check.onchange = () => { if(check.checked) picked.add(r.title); else picked.delete(r.title); updateSelection(matches); };
    const caption = document.createElement('span');
    caption.textContent = r.id ? r.content.split('\n',2)[1] || r.title : r.title;
    caption.title = r.title;
    label.append(check, caption); row.append(label);
    const date = document.createElement('small');
    date.textContent = localDate(new Date(r.modified)); row.append(date);
    const detail = document.createElement('details'), summary = document.createElement('summary'), body = document.createElement('pre');
    detail.dataset.record = r.id || r.title;
    detail.open = expanded.has(detail.dataset.record);
    const archived = r.id ? r.archivedVersion === r.version : receipts.get(r.title)?.hash === r.hash;
    summary.textContent = archived ? '已归档 · 查看正文' : '本机预览';
    body.textContent = r.content; detail.append(summary,body); row.append(detail); container.append(row);
  }
  if (!container.children.length) container.textContent = records.size ? '没有匹配的记录' : '还没有可预览的工作记录';
  updateSelection(matches);
}
async function identity() {
  if (localLauncher) throw Error('本机模式只在本设备读取资料。公司启用桌面接收端后，请打开公司工作台，登录并选择同步范围。');
  if (!hosted) throw Error('本地文件模式可搜索和摘录。同步需要从 WeManage 打开本工具。');
  const resp = await fetch(new URL('session',api),{cache:'no-store'});
  if (resp.status===401) { el('login').hidden=false; throw Error('请登录公司 WeManage，再开启同步'); }
  if (!resp.ok) throw Error('无法连接 WeManage');
  const who = await resp.json();
  if (!who.id || !who.csrf_token) throw Error('WeManage 未返回有效成员信息');
  el('account').textContent=who.name; el('login').hidden=true;
  return who;
}
async function scan() {
  if (!folder || scanning) return;
  scanning=true;
  const rev=revision, dir=folder, agent=el('agent').value, project=el('project').value.trim();
  const items=new Map(), errors=[];
  try {
    for await (const h of dir.values()) {
      if (revision!==rev) return;
      if (h.kind!=='file' || h.name.startsWith('.') || (!plain(h.name) && !(formats() && /\.jsonl$/i.test(h.name)))) continue;
      try {
        const f=await h.getFile();
        if(f.size>limit) throw Error('文件超过 1 MiB，未导入');
        const buffer=await f.arrayBuffer();
        if(buffer.byteLength>limit) throw Error('文件超过 1 MiB，未导入');
        const raw=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
        const content=plain(h.name)?raw:transcript(raw,agent);
        if(!content.trim() || content.includes('\0')) throw Error('正文为空或包含非文本内容');
        const digest=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
        const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
        items.set(h.name,{title:h.name,content,hash,modified:f.lastModified});
      } catch(e) { errors.push(h.name+'：'+e.message); }
    }
    if (revision!==rev) return;
    records=items;
    for(const name of picked) if(!records.has(name)) picked.delete(name);
    el('scope').textContent=dir.name+' · '+items.size+' 份可预览记录'+(errors.length?'\n'+errors.join('\n'):'');
    render();
    if (!syncing) return;
    const who=await identity();
    if (rev!==revision || !syncing) return;
    if (who.id!==activeMember) { stopSync(); el('sync').textContent='登录成员已变化，已暂停同步'; return; }
    for (const r of items.values()) {
      if (!syncing || rev!==revision) return;
      if (receipts.get(r.title)?.hash===r.hash) continue;
      const response=await fetch(new URL('desktop-exports',api),{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':who.csrf_token},body:JSON.stringify({owner:who.id,agent,project,title:r.title,content:r.content})});
      if (!response.ok) throw Error('上传未确认（HTTP '+response.status+'），待重试');
      const receipt=await response.json();
      if(receipt.sha256!==r.hash || !receipt.id) throw Error('服务端回执校验失败');
      if(rev!==revision || !syncing) return;
      receipts.set(r.title,{hash:r.hash,id:receipt.id});
    }
    el('sync').textContent='本轮已确认 '+Array.from(items.values()).filter(r=>receipts.get(r.title)?.hash===r.hash).length+' 份 · '+new Date().toLocaleTimeString();
    render();
  } catch(e) {if(rev===revision && e.name!=='AbortError') el('sync').textContent=e.message;}
  finally {scanning=false;}
}
function stopSync(){ archiveState(''); syncing=false;activeMember=null;controller?.abort();revision++;el('toggle').textContent='开启自动同步';el('sync').textContent='已暂停';}
el('choose').onclick=async()=>{
  if(!el('project').value.trim()){el('scope').textContent='请先填写工作项目';el('project').focus();return;}
  if(!window.showDirectoryPicker){el('scope').textContent='请使用桌面版 Edge 或 Chrome，在本机或 HTTPS 地址打开。';return;}
  try{const dir=await showDirectoryPicker({mode:'read'});reset();folder=dir;el('toggle').disabled=false;await scan();}
  catch(e){if(e.name!=='AbortError')el('scope').textContent=e.message;}
};
el('agent').onchange=reset;el('project').oninput=reset;el('search').oninput=render;
el('period').onchange = render;
el('selectMatches').onclick = () => {
  for (const record of matchingRecords()) picked.add(record.title);
  render();
};
el('clearPicks').onclick = () => { picked.clear(); render(); };
for (const kind of ['daily', 'weekly', 'handoff']) {
  el(kind).onclick = () => {
    const selected = [...picked].map(title => records.get(title));
    const doc = exportDocument(kind, activeScope?.group || el('project').value.trim(), activeScope?.agent || el('agent').value, selected);
    downloadText(doc.name, doc.text, 'text/markdown;charset=utf-8');
    el('exportStatus').textContent = doc.label + '已生成，包含 ' + selected.length + ' 份勾选记录。';
  };
}
el('downloadReminder').onclick = () => {
  const input = el('reminderTime');
  if (!input.reportValidity()) return;
  downloadText('WorkBuddy-每日签到.ics', reminderCalendar(input.value, new Date()), 'text/calendar;charset=utf-8');
  el('reminderStatus').textContent = '请打开下载的 .ics 文件，并在日历中确认导入每日提醒。';
};
el('transfer').onclick = () => {
  const selected = [...picked].map(title => records.get(title))
    .sort((a, b) => a.modified - b.modified || a.title.localeCompare(b.title));
  if (!selected.length) return;
  const project = activeScope?.group || el('project').value.trim();
  const agent = activeScope?.agent || el('agent').value;
  const parts = ['# ' + project, '来源工具：' + agent];
  for (const record of selected) parts.push('## ' + record.title, record.content);
  el('transferText').value = parts.join('\n\n');
  el('transferNext').value = '';
  el('transferStatus').textContent = '';
  el('transferDialog').showModal();
};
function transferBody() {
  const next = el('transferNext').value.trim();
  return [next && '下一步：' + next, el('transferText').value].filter(Boolean).join('\n\n');
}
el('transferCopy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(transferBody());
    el('transferStatus').textContent = '已复制，可粘贴到另一个 AI 的新对话。';
  } catch {
    el('transferStatus').textContent = '无法访问剪贴板，可以保存 Markdown。';
  }
};
el('transferSave').onclick = () => downloadText('续聊-' + localDate(new Date()) + '.md', transferBody(), 'text/markdown;charset=utf-8');
el('transferClose').onclick = () => el('transferDialog').close();
el('transferDialog').onclose = () => {
  el('transferNext').value = '';
  el('transferText').value = '';
};
el('copy').onclick=async()=>{try{await navigator.clipboard.writeText([...picked].map(k=>k+'\n'+records.get(k).content).join('\n\n'));el('scope').textContent='已复制 '+picked.size+' 份完整正文';}catch{el('scope').textContent='剪贴板不可用，请展开记录后复制';}};
el('toggle').onclick=async()=>{
  if(syncing){stopSync();return;}
  const rev=revision;
  try{const who=await identity();if(rev!==revision)return;
    if(receiptOwner!==who.id){receipts.clear();receiptOwner=who.id;render();}
    activeMember=who.id;
    el('disclosure').textContent=who.name+' 将把 '+el('agent').value+' / '+el('project').value.trim()+' 的资料夹「'+folder.name+'」中已预览的正文和后续新增正文上传到 '+api.host+'。';
    el('confirm').showModal();
  }catch(e){el('sync').textContent=e.message;}
};
el('yes').onclick=()=>{el('confirm').close();syncing=true;archiveState('已开启 · ' + folder.name);controller=new AbortController();el('toggle').textContent='暂停同步';el('sync').textContent='正在核对工作记录';scan();};
el('no').onclick=()=>el('confirm').close();
setInterval(scan,20000);reset();
let before=0, previousQuery='';
async function lookup(more) {
  el('lookup').disabled=true;el('more').disabled=true;
  try {
    await identity();
    const q=more?previousQuery:el('remoteQuery').value.trim();
    const url=new URL('desktop-exports',api);url.searchParams.set('q',q);
    if(more)url.searchParams.set('before',String(before));
    const resp=await fetch(url,{cache:'no-store'});if(!resp.ok)throw Error('查询失败（HTTP '+resp.status+'）');
    const data=await resp.json();before=data.next;previousQuery=q;
    el('history').replaceChildren();
    for(const r of data.records) {
      const detail=document.createElement('details'), label=document.createElement('summary'), body=document.createElement('pre');
      label.textContent=r.agent+' · '+r.project+' · '+r.title+' · '+new Date(r.at).toLocaleString();
      detail.append(label,body);el('history').append(detail);
      detail.ontoggle=async()=>{
        if (!detail.open || body.dataset.loaded) return;
        try {
          const url=new URL('desktop-exports',api);url.searchParams.set('id',String(r.id));
          const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('读取正文失败');
          body.textContent=(await response.json()).content;body.dataset.loaded='true';
        } catch(e){body.textContent=e.message;}
      };
    }
    if(!data.records.length)el('history').textContent='没有匹配的归档';el('more').hidden=!before;
  }catch(e){el('history').textContent=e.message;el('more').hidden=true;}
  finally{el('lookup').disabled=false;el('more').disabled=false;}
}
el('lookup').onclick=()=>lookup(false);el('more').onclick=()=>lookup(true);
el('remoteQuery').onkeydown=e=>{if(e.key==='Enter')lookup(false);};
