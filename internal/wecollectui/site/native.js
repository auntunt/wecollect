'use strict';

const nativeKey = new URLSearchParams(location.hash.slice(1)).get('key');
let activeScope = null;
let nativeGeneration = 0;
let nativeLoading = false;
let nativePending = false;
let groups = new Map();

async function nativeFetch(path) {
  const response = await fetch('/native/' + path, {
    headers: {'X-WeCollect-Local': nativeKey}, cache: 'no-store'
  });
  if (!response.ok) {
    if (response.status === 403) throw Error('请从桌面应用重新打开工作台');
    throw Error((await response.text()).trim() || '本机读取失败');
  }
  return response.json();
}

function setScope(value) {
  disconnectPeer();
  nativeGeneration++;
  reset();
  activeScope = groups.get(value) || null;
  el('nativeSync').hidden = !activeScope;
  el('folderSync').hidden = Boolean(activeScope);
  el('syncProject').value = '';
  el('pairStatus').textContent = '';
}

async function refreshNative() {
  if (nativeLoading) { nativePending = true; return; }
  nativeLoading = true;
  const generation = nativeGeneration;
  try {
    const data = await nativeFetch('index');
    if (generation !== nativeGeneration) return;
    const selected = el('nativeGroup').value;
    groups = new Map();
    const options = [new Option('选择工作区', '')];
    for (const session of data.sessions) {
      const key = JSON.stringify([session.agent, session.group]);
      if (!groups.has(key)) groups.set(key, {agent:session.agent, group:session.group, sessions:[]});
      groups.get(key).sessions.push(session);
    }
    for (const [key, scope] of groups) {
      options.push(new Option(scope.agent + ' · ' + scope.group + '（' + scope.sessions.length + '）', key));
    }
    el('nativeGroup').replaceChildren(...options);
    el('nativeIssues').textContent = data.issues.join('\n');
    if (activeScope && !groups.has(selected)) setScope('');
    if (!groups.has(selected)) {
      el('nativeStatus').textContent = groups.size ? '已找到 ' + groups.size + ' 个工作区，请选择要读取的范围。' : '尚未找到支持的本地会话。';
      return;
    }
    el('nativeGroup').value = selected;
    activeScope = groups.get(selected);
    const items = new Map();
    const failures = [];
    for (const session of activeScope.sessions) {
      if (generation !== nativeGeneration) return;
      const old = records.get(session.title);
      if (old?.version === session.version && old.id === session.id) {
        items.set(session.title, old);
        continue;
      }
      try {
        const {content} = await nativeFetch('session?id=' + encodeURIComponent(session.id));
        items.set(session.title, {...session, content});
      } catch (error) {
        failures.push(session.title + '：' + error.message);
      }
    }
    if (generation !== nativeGeneration) return;
    records = items;
    for (const title of picked) if (!records.has(title)) picked.delete(title);
    render();
    el('nativeStatus').textContent = '已读取 ' + records.size + ' 份会话 · 每 20 秒检查更新';
    el('nativeIssues').textContent = [...data.issues,...failures].join('\n');
    offerRecords();
  } catch (error) {
    if (generation === nativeGeneration) el('nativeStatus').textContent = error.message;
  } finally {
    nativeLoading = false;
    if (nativePending) {nativePending = false; void refreshNative();}
  }
}

function initNative() {
  if (!localLauncher || !nativeKey) return;
  el('native').hidden = false;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '其他来源 · 选择资料夹';
  el('manual').querySelector('h2').remove();
  details.append(summary, ...el('manual').childNodes);
  el('manual').append(details);
  // Entering the fallback flow releases the previous native scope before any folder scan.
  details.addEventListener('toggle', () => {
    if (details.open && activeScope) {
      el('nativeGroup').value = '';
      setScope('');
      void refreshNative();
    }
  });
  el('nativeGroup').onchange = () => {
    details.open = false;
    setScope(el('nativeGroup').value);
    el('nativeStatus').textContent = '正在读取所选工作区…';
    void refreshNative();
  };
  el('refreshNative').onclick = refreshNative;
  void refreshNative();
  setInterval(refreshNative, 20000);
}
