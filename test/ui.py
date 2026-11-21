import asyncio, sys
from playwright.async_api import async_playwright
BASE = 'file:///home/claude/hr-portal/public/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--allow-file-access-from-files'])
        pg = await b.new_page(viewport={'width':1200,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
        # facilitator
        await pg.goto(BASE+'index.html')
        await pg.fill('input[name=email]','yashvi@example.com'); await pg.fill('input[name=password]','demo1234'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('text=Sessions and payments')
        await pg.click('[data-claim]'); await pg.fill('textarea[name=note]','Took Group 2'); await pg.click('.modal button[type=submit]')
        await pg.wait_for_selector('text=Awaiting verification')
        await pg.screenshot(path='test/fac.png', full_page=True)
        # admin (separate page => separate demo backend; that's fine)
        await pg.goto(BASE+'admin/index.html')
        await pg.fill('input[name=email]','vp@acriindia.org'); await pg.fill('input[name=password]','vp123456'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('text=To do')
        await pg.click('button[data-tab=fund]')
        await pg.click('#cr'); await pg.fill('input[name=amount]','45000'); await pg.click('.modal button[type=submit]')
        await pg.wait_for_timeout(200)
        for head, amt in [('Student Book Development','18000'),('Programme Resources & Session Material','9000')]:
            await pg.click('#de'); await pg.select_option('select[name=head]', head); await pg.fill('input[name=amount]',amt); await pg.click('.modal button[type=submit]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path='test/fund.png', full_page=True)
        await pg.click('button[data-tab=programme]'); await pg.click('#ep')
        await pg.select_option('select[name=pay_model]','per_session'); await pg.fill('input[name=rate_per_session]','1000'); await pg.click('.modal button[type=submit]')
        await pg.wait_for_timeout(200)
        await pg.click('#ns'); await pg.fill('input[name=number]','X1'); await pg.fill('input[name=date]','2026-11-14'); await pg.select_option('select[name=status]','held'); await pg.check('input[name=extra]'); await pg.click('.modal button[type=submit]')
        await pg.wait_for_timeout(200)
        await pg.click('button[data-tab=attendance]'); await pg.screenshot(path='test/att.png', full_page=True)
        await pg.click('button[data-tab=payments]'); await pg.screenshot(path='test/pay.png', full_page=True)
        await pg.click('button[data-tab=overview]'); await pg.screenshot(path='test/over.png', full_page=True)
        # mobile facilitator login screen
        m = await b.new_page(viewport={'width':390,'height':800}); await m.goto(BASE+'index.html'); await m.screenshot(path='test/login_m.png')
        print('errors:', errs)
        await b.close()
asyncio.run(main())
