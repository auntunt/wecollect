'use strict';

function localDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return [date.getFullYear(), month, day].join('-');
}

function weekRange(period, today) {
  if (period === 'all') return null;
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  if (period === 'today') {
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {start, end};
  }
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday - (period === 'lastWeek' ? 7 : 0));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return {start, end};
}

const reportFormats = {
  daily: {label: '工作日报', sections: ['今日完成', '待解决问题', '下一步']},
  weekly: {label: '工作周报', sections: ['本周成果', '待解决问题', '下周计划']},
  handoff: {label: '任务交接单', sections: ['任务目标', '当前进展', '下一步与验收条件']}
};

function exportDocument(kind, project, agent, selected, notes) {
  const {label, sections} = reportFormats[kind];
  const entries = [...selected].sort((a, b) => a.modified - b.modified || a.title.localeCompare(b.title));
  const parts = ['# ' + project + ' · ' + label, '来源工具：' + agent, '记录数：' + entries.length];
  for (const [index, section] of sections.entries()) {
    const note = notes[index];
    parts.push('## ' + section, note.trim() ? note : '（待填写）');
  }
  parts.push('## 工作记录原文');
  for (const entry of entries) {
    parts.push('### ' + entry.title, '文件修改日期：' + localDate(new Date(entry.modified)), entry.content);
  }
  const name = label + '-' + localDate(new Date()) + '.md';
  return {label, name, text: parts.join('\n\n') + '\n'};
}

function reminderCalendar(value, now) {
  const [hour, minute] = value.split(':').map(Number);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const start = localDate(next).replaceAll('-', '') + 'T' + value.replace(':', '') + '00';
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WeCollect//WorkBuddy Reminder//ZH',
    'BEGIN:VEVENT', 'UID:workbuddy-daily-checkin@wecollect.local', 'DTSTAMP:' + stamp,
    'DTSTART:' + start, 'DURATION:PT5M', 'RRULE:FREQ=DAILY', 'TRANSP:TRANSPARENT',
    'SUMMARY:WorkBuddy 签到', 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY',
    'DESCRIPTION:打开 WorkBuddy 完成今日签到', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''
  ].join('\r\n');
}

function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
