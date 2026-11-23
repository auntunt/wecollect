'use strict';

let usageGroups = new Map();

function updateUsageIndex(index) {
  usageGroups = index;
  const focus = el('usageFocus');
  const selected = focus.value;
  const options = [new Option('全部工作区', '')];
  for (const [key, scope] of index) {
    options.push(new Option(scope.agent + ' · ' + scope.group, key));
  }
  // Keep a missing focus empty of records until the user chooses a different one.
  if (selected && !index.has(selected)) {
    const [agent, group] = JSON.parse(selected);
    options.push(new Option(agent + ' · ' + group + '（目前无记录）', selected));
  }
  focus.replaceChildren(...options);
  focus.value = selected;
  renderUsage();
}

function usageSummary(now) {
  const period = el('usagePeriod').value;
  const focus = el('usageFocus').value;
  const {start, end} = weekRange(period, now);
  const tools = new Map();
  let workspaces = 0, sessions = 0;
  for (const [key, scope] of usageGroups) {
    if (focus && key !== focus) continue;
    const count = scope.sessions.filter(row => row.modified >= start && row.modified < end).length;
    if (!count) continue;
    workspaces++;
    sessions += count;
    tools.set(scope.agent, (tools.get(scope.agent) || 0) + count);
  }
  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  return {
    label: period === 'today' ? '统计日报' : '统计周报',
    dates: period === 'today' ? localDate(start) : localDate(start) + ' 至 ' + localDate(lastDay),
    total: workspaces + ' 个工具工作区 · ' + sessions + ' 份会话（按最后修改时间）',
    rows: [...tools].sort(([a], [b]) => a.localeCompare(b)).map(([agent, count]) => agent + ' · ' + count + ' 份'),
    sessions
  };
}

function renderUsage() {
  const summary = usageSummary(new Date());
  el('usageTotal').textContent = summary.total;
  const rows = summary.rows.map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  });
  el('usageRows').replaceChildren(...rows);
  el('usageExport').textContent = '导出' + summary.label;
  el('usageExport').disabled = !summary.sessions;
}

function exportUsage() {
  const summary = usageSummary(new Date());
  const focus = el('usageFocus').selectedOptions[0].textContent;
  const body = ['# ' + summary.label, summary.dates, focus, summary.total, ...summary.rows].join('\n\n');
  downloadText(summary.label + '-' + summary.dates + '.md', body + '\n', 'text/markdown;charset=utf-8');
}
