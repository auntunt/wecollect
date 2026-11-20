import os
from playwright.sync_api import sync_playwright

base = os.environ['WECOLLECT_TEST_ORIGIN']
with sync_playwright() as api:
    browser = api.chromium.launch(channel='chrome')
    page = browser.new_page()
    page.context.add_cookies([dict(name='aiseat_sess', value=os.environ['WECOLLECT_TEST_COOKIE'], url=base)])
    page.goto(base+'/wecollect/')
    page.evaluate("""async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('工作导出', {create:true});
      const file = await dir.getFileHandle('浏览器工作记录.md', {create:true});
      const writer = await file.createWritable();
      await writer.write('已完成登录原型，与客户确认验收。'); await writer.close();
      window.showDirectoryPicker = async () => dir;
    }""")
    for agent, event in [
        ('Cursor', {'role':'user','message':{'content':'工作提问'}}),
        ('Claude Code', {'type':'user','message':{'role':'user','content':'工作提问'}}),
        ('Codex', {'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'工作提问'}]}}),
        ('WorkBuddy', {'type':'message','role':'user','content':[{'type':'input_text','text':'<system-reminder>内部环境</system-reminder><user_query>工作提问</user_query>'}]})
    ]:
        assert page.evaluate("([a,e])=>transcript(JSON.stringify(e),a)",[agent,event])=='提问\n工作提问'
    page.select_option('#agent','千问工作')
    page.fill('#project','浏览器测试')
    page.click('#choose')
    page.get_by_text('浏览器工作记录.md',exact=False).first.wait_for()
    page.check('.record input')
    page.fill('#search','无此内容')
    assert page.locator('.record').count()==0
    page.fill('#search','客户确认')
    assert page.locator('.record').count()==1
    page.click('#toggle')
    page.locator('#confirm').wait_for(state='visible',timeout=8000)
    page.click('#yes')
    page.wait_for_function("document.querySelector('#sync').textContent.includes('本轮已确认 1 份')")
    page.click('#toggle')
    page.fill('#remoteQuery','客户确认');page.click('#lookup')
    page.wait_for_function("document.querySelector('#history').textContent.includes('浏览器工作记录.md')")
    page.locator('#history summary').first.click()
    page.wait_for_function("document.querySelector('#history pre').textContent.includes('与客户确认验收')")
    page.screenshot(path='/tmp/wecollect-pilot-desktop.png')
    page.set_viewport_size({'width':390,'height':800})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    browser.close()
