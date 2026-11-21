import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        for u in ['index.html','admin/index.html']:
            pg=await b.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
            await pg.goto('file:///home/claude/hr-portal/public/'+u)
            await pg.fill('input[name=email]','a@b.com'); await pg.fill('input[name=password]','x'*8); await pg.click('button[type=submit]')
            await pg.wait_for_selector('.note.err'); print(u, await pg.inner_text('.note.err'), errs, 'demo-flag' in await pg.content())
        await b.close()
asyncio.run(main())
