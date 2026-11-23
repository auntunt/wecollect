'use strict';

const nativeKey = new URLSearchParams(location.hash.slice(1)).get('key');
let activeScope = null;
let nativeGeneration = 0;
let nativeLoading = false;
let nativePending = false;
let groups = new Map();

let startupScope = null;
let restoreOnOpen = true;
let savingStartup = false;

function scopeKey(scope) {
  return scope && JSON.stringify([scope.agent, scope.group]);
}

function showStartupChoice() {
  el('pinScope').hidden = !activeScope || scopeKey(activeScope) === scopeKey(startupScope);
  el('forgetScope').hidden = !startupScope;
  el('pinScope').disabled = el('forgetScope').disabled = savingStartup;
  el('startupScope').textContent = startupScope ? '启动工作区：' + startupScope.agent + ' · ' + startupScope.group : '';
}

async function saveStartup(scope) {
  if (savingStartup) return;
  savingStartup = true;
  showStartupChoice();
  const choice = scope && {agent: scope.agent, group: scope.group};
  try {
    await nativeFetch('startup', {method: 'PUT', body: JSON.stringify(choice)});
    startupScope = choice;
  } catch (error) {
    el('startupError').textContent = error.message;
    return;
  } finally {
    savingStartup = false;
    showStartupChoice();
  }
  el('startupError').textContent = '';
}

async function nativeFetch(path, options = {}) {
  const response = await fetch('/native/' + path, {
    ...options, headers: {'X-WeCollect-Local': nativeKey}, cache: 'no-store'
  });
  if (!response.ok) {
    if (response.status === 403) throw Error('请从桌面应用重新打开工作台');
    throw Error((await response.text()).trim() || '本机读取失败');
  }
  if (response.status !== 204) return response.json();
}

function setScope(value) {
  disconnectPeer();
  nativeGeneration++;
  reset();
  activeScope = groups.get(value) || null;
  showStartupChoice();
  el('nativeSync').hidden = !activeScope;
  el('folderSync').hidden = Boolean(activeScope);
  el('syncProject').value = '';
  el('pairStatus').textContent = '';
}

async function refreshNative() {
  if (nativeLoading) { nativePending = true; return; }
  nativeLoading = true;
  let generation = nativeGeneration;
  try {
    const data = await nativeFetch('index');
    if (generation !== nativeGeneration) return;
    let selected = el('nativeGroup').value;
    groups = new Map();
    const options = [new Option('选择工作区', '')];
    for (const session of data.sessions) {
      const key = scopeKey(session);
      if (!groups.has(key)) groups.set(key, {agent:session.agent, group:session.group, sessions:[]});
      groups.get(key).sessions.push(session);
    }
    updateUsageIndex(groups);
    for (const [key, scope] of groups) {
      options.push(new Option(scope.agent + ' · ' + scope.group + '（' + scope.sessions.length + '）', key));
    }
    el('nativeGroup').replaceChildren(...options);
    if (restoreOnOpen) {
      restoreOnOpen = false;
      const saved = scopeKey(startupScope);
      if (groups.has(saved)) {
        selected = saved;
        setScope(saved);
        generation = nativeGeneration;
      }
    }
    if (activeScope && !groups.has(selected)) setScope('');
    if (!groups.has(selected)) {
      el('nativeIssues').textContent = data.issues.join('\n');
      el('nativeStatus').textContent = groups.size ? '' : '尚未找到支持的本地会话。';
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

async function initNative() {
  if (!localLauncher || !nativeKey) return;
  el('native').hidden = false;
  el('overview').hidden = false;
  el('usagePeriod').onchange = renderUsage;
  el('usageFocus').onchange = renderUsage;
  el('usageExport').onclick = exportUsage;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '其他来源 · 选择资料夹';
  el('manual').querySelector('h2').remove();
  details.append(summary, ...el('manual').childNodes);
  el('manual').append(details);
  // Entering the fallback flow releases the previous native scope before any folder scan.
  details.addEventListener('toggle', () => {
    if (details.open) restoreOnOpen = false;
    if (details.open && activeScope) {
      el('nativeGroup').value = '';
      setScope('');
      void refreshNative();
    }
  });
  el('nativeGroup').onchange = () => {
    restoreOnOpen = false;
    details.open = false;
    setScope(el('nativeGroup').value);
    el('nativeStatus').textContent = '正在读取所选工作区…';
    void refreshNative();
  };
  el('pinScope').onclick = () => saveStartup(activeScope);
  el('forgetScope').onclick = () => saveStartup(null);
  try {
    startupScope = await nativeFetch('startup');
  } catch (error) {
    el('startupError').textContent = error.message;
  }
  showStartupChoice();
  el('refreshNative').onclick = refreshNative;
  void refreshNative();
  setInterval(refreshNative, 20000);
}
