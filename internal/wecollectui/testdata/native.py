"""Verify real discovery and cross-origin handoff with synthetic local sessions and a test receiver."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

site = Path(__file__).resolve().parents[1] / 'site'
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    session = root / '.claude/projects/pilot/12345678-abcd-1234-abcd-123456789012.jsonl'
    session.parent.mkdir(parents=True)
    def line(text):
        return json.dumps({'type':'user','message':{'role':'user','content':text}}) + '\n'
    session.write_text(line('首次会话'))
    env = dict(os.environ, HOME=tmp, USERPROFILE=tmp, CODEX_HOME=str(root/'.codex'), CLAUDE_CONFIG_DIR=str(root/'.claude'))
    process = subprocess.Popen([sys.argv[1], '-no-open'], env=env, text=True, stdout=subprocess.PIPE)
    try:
        url = process.stdout.readline().strip()
        with sync_playwright() as api:
            browser = api.chromium.launch(channel='chrome')
            ctx = browser.new_context()
            submitted = []
            def company(route):
                path = route.request.url.split('?')[0]
                if path.endswith('/api/session'):
                    route.fulfill(json={'id':5,'name':'试用成员','csrf_token':'test'})
                elif path.endswith('/api/desktop-exports'):
                    assert route.request.headers.get('x-csrf-token') == 'test'
                    entry = route.request.post_data_json
                    assert entry['owner'] == 5 and entry['project'] == '测试项目' and entry['agent'] == 'Claude Code'
                    submitted.append(entry)
                    route.fulfill(json={'id':len(submitted),'sha256':hashlib.sha256(entry['content'].encode()).hexdigest()})
                else:
                    name = path.rsplit('/', 1)[-1] or 'index.html'
                    assert name in {p.name for p in site.iterdir()}
                    route.fulfill(path=site/name)
            ctx.route('https://ai.cloudwaveai.cn/**', company)
            page = ctx.new_page()
            page.clock.install()
            page.goto(url)
            assert page.evaluate("fetch('/native/index').then(r=>r.status)") == 403
            expect(page.locator('#nativeGroup option')).to_have_count(2)
            expect(page.locator('#usageTotal')).to_contain_text('1 个工具工作区 · 1 份会话')
            second = session.parent.with_name('team-b') / session.name
            second.parent.mkdir()
            second.write_text(line('其他项目正文'))
            page.clock.fast_forward(20500)
            expect(page.locator('#usageTotal')).to_contain_text('2 个工具工作区 · 2 份会话')
            focus = json.dumps(['Claude Code', 'pilot'], separators=(',', ':'))
            page.select_option('#usageFocus', value=focus)
            expect(page.locator('#usageTotal')).to_contain_text('1 个工具工作区 · 1 份会话')
            page.select_option('#usagePeriod', 'week')
            with page.expect_download() as saved:
                page.click('#usageExport')
            report = Path(saved.value.path()).read_text()
            assert '统计周报' in report and 'pilot' in report and '1 份会话' in report
            assert '其他项目正文' not in report and '首次会话' not in report
            assert not submitted and page.locator('#nativeGroup').input_value() == ''
            assert page.locator('.record').count() == 0
            page.select_option('#nativeGroup', value=focus)
            expect(page.locator('#records')).to_contain_text('首次会话')
            expect(page.locator('.record summary')).to_have_text('本机预览')
            page.click('#pinScope')
            expect(page.locator('#startupScope')).to_contain_text('pilot')
            page.locator('.record summary').click()
            page.fill('#search','首次会话')
            assert page.locator('.record').count() == 1 and not submitted
            page.fill('#syncProject','测试项目')
            with page.expect_popup() as popup:
                page.click('#pair')
            receiver = popup.value
            receiver.locator('#allowPeer:enabled').wait_for()
            assert not submitted
            expect(page.locator('#archiveState')).to_contain_text('等待确认')
            receiver.click('#allowPeer')
            expect(page.locator('#pairStatus')).to_contain_text('公司已确认 1')
            expect(page.locator('#archiveState')).to_contain_text('已开启 · 测试项目')
            expect(receiver.locator('#archiveState')).to_contain_text('正在接收 · 测试项目')
            page.select_option('#usageFocus', value='')
            expect(page.locator('#usageTotal')).to_contain_text('2 份会话')
            with session.open('a') as f:
                f.write(line('追加回复'))
            # Accelerate the actual polling timer in the browser.
            page.clock.fast_forward(20500)
            expect(page.locator('#records')).to_contain_text('追加回复')
            expect(page.locator('#pairStatus')).to_contain_text('公司已确认 1')
            expect(page.locator('.record details')).to_have_attribute('open', '')
            assert len(submitted)==2 and '追加回复' in submitted[-1]['content']
            page.click('#unpair')
            expect(page.locator('#archiveState')).to_contain_text('未开启')
            expect(receiver.locator('#peerStatus')).to_contain_text('断开')
            new = session.with_name('abcdef12-abcd-1234-abcd-123456789012.jsonl')
            new.write_text(line('另一份会话'))
            page.fill('#search','')
            page.clock.fast_forward(20500)
            expect(page.locator('.record')).to_have_count(2)
            assert page.locator('.record').count()==2 and len(submitted)==2
            assert sorted(page.locator('.record summary').all_inner_texts()) == sorted(['本机预览','已归档 · 查看正文'])
            if os.getenv('WECOLLECT_SCREENSHOT'):
                page.screenshot(path=os.environ['WECOLLECT_SCREENSHOT'], full_page=True)
            page.select_option('#nativeGroup', value='')
            assert page.locator('.record').count()==0
            receiver.close()
            def restart():
                global process
                page.close()
                process.terminate()
                process.wait(timeout=5)
                process = subprocess.Popen([sys.argv[1], '-no-open'], env=env, text=True, stdout=subprocess.PIPE)
                reopened = ctx.new_page()
                reopened.goto(process.stdout.readline().strip())
                return reopened

            page = restart()
            expect(page.locator('.record')).to_have_count(2)
            expect(page.locator('#unpair')).to_be_hidden()
            assert len(ctx.pages) == 1 and len(submitted) == 2
            session.parent.rename(session.parent.with_name('另一个工作区'))
            page = restart()
            expect(page.locator('#usageTotal')).to_contain_text('3 份会话')
            expect(page.locator('.record')).to_have_count(0)
            expect(page.locator('#startupScope')).to_contain_text('pilot')
            page.click('#forgetScope')
            expect(page.locator('#forgetScope')).to_be_hidden()
            session.parent.with_name('另一个工作区').rename(session.parent)
            page = restart()
            expect(page.locator('#usageTotal')).to_contain_text('3 份会话')
            expect(page.locator('.record')).to_have_count(0)
            browser.close()
            print('PASS discovery, preview, consent, receiver acknowledgment, updates, new sessions and disconnect')
    finally:
        process.terminate()
        process.wait(timeout=5)
