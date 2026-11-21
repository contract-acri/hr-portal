import asyncio, http.server, threading, functools
from playwright.async_api import async_playwright
H=http.server.ThreadingHTTPServer(('127.0.0.1',8765),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/hr-portal/public'))
threading.Thread(target=H.serve_forever,daemon=True).start()
core=open('/home/claude/hr-portal/backend/Core.js').read().replace("if (typeof module","if (false && typeof module")
mock=open('/home/claude/hr-portal/test/mockfetch.js').read()
B='http://127.0.0.1:8765/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1200,'height':900})
        await ctx.add_init_script(core+"\n"+mock)
        pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'admin/')
        await pg.fill('input[name=email]','vice-president@acriindia.org'); await pg.fill('input[name=password]','vp123456'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('text=To do')
        await pg.click('button[data-tab=fund]')
        await pg.click('#cr'); await pg.fill('input[name=amount]','45000'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(150)
        await pg.click('#de'); await pg.select_option('select[name=head]','Student Book Development'); await pg.fill('input[name=amount]','18000')
        await pg.click('.modal button[type=submit]'); await pg.wait_for_selector('.modal .note.err')  # must confirm
        await pg.check('input[name=confirm]'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(150)
        await pg.click('#de'); await pg.select_option('select[name=head]','Programme Resources & Session Material'); await pg.fill('input[name=amount]','9000'); await pg.check('input[name=confirm]'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(150)
        await pg.click('button[data-tab=payments]'); await pg.wait_for_selector('text=Shares as of today')
        await pg.screenshot(path='test/shares.png',full_page=True)
        await pg.click('#dist'); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(200)
        await pg.click('[data-po=approved]'); await pg.wait_for_timeout(150)
        await pg.screenshot(path='test/shares2.png',full_page=True)
        await pg.click('#lo')
        await pg.goto(B)
        await pg.fill('input[name=email]','yashvi.mehta07@gmail.com'); await pg.fill('input[name=password]','yashvi123'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('text=Sessions and payments'); await pg.screenshot(path='test/fac2.png',full_page=True)
        print('errors',errs)
        await b.close()
asyncio.run(main())
