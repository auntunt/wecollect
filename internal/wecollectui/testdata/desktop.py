"""Smoke-test the packaged launcher's local-only tools with Chrome."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

profile = tempfile.TemporaryDirectory()
test_env = dict(os.environ, HOME=profile.name, USERPROFILE=profile.name, CODEX_HOME=profile.name + '/.codex',
                CLAUDE_CONFIG_DIR=profile.name + '/.claude')
launcher = subprocess.Popen([sys.argv[1], '-no-open'], stdout=subprocess.PIPE, text=True, env=test_env)
try:
    origin = launcher.stdout.readline().strip()
    assert origin.startswith('http://127.0.0.1:')
    with sync_playwright() as api:
        browser = api.chromium.launch(channel='chrome')
        page = browser.new_page(timezone_id='Asia/Shanghai', accept_downloads=True)
        page_errors = []
        writes = []
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.on('request', lambda r: writes.append(r.url) if r.method == 'POST' else None)
        page.goto(origin)
        page.evaluate("""() => {
          const sunday = new Date(2026, 0, 4, 23, 59);
          const today = weekRange('today', sunday);
          if (localDate(today.start) !== '2026-01-04' || localDate(today.end) !== '2026-01-05'
              || today.start.getHours() !== 0 || today.end.getHours() !== 0) throw Error('day boundary');
          const last = weekRange('lastWeek', sunday);
          const week = weekRange('week', sunday);
          if (localDate(last.start) !== '2025-12-22' || localDate(week.start) !== '2025-12-29'
              || localDate(week.end) !== '2026-01-05') throw Error('week boundary');
          if (!reminderCalendar('09:30', sunday).includes('DTSTART:20260105T093000'))
            throw Error('next reminder');
          const monday = weekRange('week', new Date()).start.getTime();
          const files = [new File(['本周任务\\n\\n保留尾行'], '本周.md', {lastModified:Date.now()}),
            new File(['旧记录'], '上周.txt', {lastModified:monday-1000})];
          window.showDirectoryPicker = async () => ({name:'导出', async *values() {
            for (const file of files) yield {name:file.name, kind:'file', getFile:async()=>file};
          }});
        }""")
        page.click('#manual summary')
        page.fill('#project', '桌面助手')
        page.click('#choose')
        expect(page.locator('.record')).to_have_count(2)
        page.select_option('#period', 'today')
        expect(page.locator('.record')).to_have_count(1)
        page.select_option('#period', 'week')
        page.click('#selectMatches')
        assert page.locator('#selection').inner_text() == '筛选结果 1 份 · 共勾选 1 份'
        page.select_option('#period', 'lastWeek')
        assert page.locator('.record').count() == 1
        assert not page.locator('.record input').is_checked()

        def download(button):
            with page.expect_download() as event:
                page.click(button)
            return Path(event.value.path()).read_bytes().decode('utf-8')

        page.click('#transfer')
        original = page.input_value('#transferText')
        assert '本周任务\n\n保留尾行' in original and '旧记录' not in original
        page.fill('#transferNext', '整理验收标准')
        page.fill('#transferText', original + '\n补充一项')
        expected = '下一步：整理验收标准\n\n' + original + '\n补充一项'
        page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async t=>{window.copied=t}}})")
        page.click('#transferCopy')
        assert page.evaluate('window.copied') == expected
        assert download('#transferSave') == expected
        if os.getenv('WECOLLECT_TRANSFER_SCREENSHOT'):
            page.screenshot(path=os.environ['WECOLLECT_TRANSFER_SCREENSHOT'])
        page.click('#transferClose')
        expect(page.locator('#transferText')).to_have_value('')
        expect(page.locator('#archiveState')).to_contain_text('未开启')
        def report(button, field, note):
            page.click(button)
            page.get_by_role('textbox', name=field, exact=True).fill(note)
            return download('#reportDownload')

        daily = report('#daily', '今日完成', '验收标准已确认\n待项目评审')
        assert '## 今日完成\n\n验收标准已确认\n待项目评审' in daily
        assert '今日完成' in daily and '本周任务\n\n保留尾行' in daily and '旧记录' not in daily
        weekly = report('#weekly', '下周计划', '发布试用版')
        assert '## 下周计划\n\n发布试用版' in weekly and '验收标准已确认' not in weekly
        assert '本周任务\n\n保留尾行' in weekly and '旧记录' not in weekly and '下周计划' in weekly
        page.click('#selectMatches')
        handoff = report('#handoff', '下一步与验收条件', '完成业务验收')
        assert '## 下一步与验收条件\n\n完成业务验收' in handoff
        assert handoff.index('旧记录') < handoff.index('本周任务') and '下一步与验收条件' in handoff
        page.click('#clearPicks')
        assert page.is_disabled('#weekly') and page.is_disabled('#handoff')
        page.select_option('#period', 'all')
        page.click('summary:has-text("WorkBuddy 签到提醒")')
        page.fill('#reminderTime', '13:45')
        calendar = download('#downloadReminder')
        assert 'RRULE:FREQ=DAILY\r\n' in calendar and 'T134500\r\n' in calendar
        assert 'TRIGGER:PT0M\r\n' in calendar and calendar.endswith('END:VCALENDAR\r\n')
        page.check('.record input >> nth=0')
        if os.getenv('WECOLLECT_SCREENSHOT'):
            page.screenshot(path=os.environ['WECOLLECT_SCREENSHOT'], full_page=True)
        page.set_viewport_size({'width':390,'height':800})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.select_option('#agent', 'Codex')
        assert page.is_disabled('#weekly')
        assert not writes and not page_errors, (writes, page_errors)
        browser.close()
        print('PASS desktop filters, complete Markdown downloads, daily calendar and local-only operation')
finally:
    launcher.terminate()
    launcher.wait(timeout=5)
    profile.cleanup()
