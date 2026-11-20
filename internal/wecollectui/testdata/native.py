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
            assert page.locator('.record').count() == 0
            page.select_option('#nativeGroup',index=1)
            expect(page.locator('#records')).to_contain_text('首次会话')
            expect(page.locator('.record summary')).to_have_text('本机预览')
            page.fill('#search','首次会话')
            assert page.locator('.record').count() == 1 and not submitted
            page.fill('#syncProject','测试项目')
            with page.expect_popup() as popup:
                page.click('#pair')
            receiver = popup.value
            receiver.locator('#allowPeer:enabled').wait_for()
            assert not submitted
            receiver.click('#allowPeer')
            expect(page.locator('#pairStatus')).to_contain_text('公司已确认 1')
            with session.open('a') as f:
                f.write(line('追加回复'))
            # Accelerate the actual polling timer in the browser.
            page.clock.fast_forward(20500)
            expect(page.locator('#records')).to_contain_text('追加回复')
            expect(page.locator('#pairStatus')).to_contain_text('公司已确认 1')
            assert len(submitted)==2 and '追加回复' in submitted[-1]['content']
            page.click('#unpair')
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
            browser.close()
            print('PASS discovery, preview, consent, receiver acknowledgment, updates, new sessions and disconnect')
    finally:
        process.terminate()
        process.wait(timeout=5)
