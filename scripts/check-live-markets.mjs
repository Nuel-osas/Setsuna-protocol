import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const base=process.env.SETSUNA_CHECK_URL ?? 'http://127.0.0.1:3009';
const out='.local/live-wiring/review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  const d=await (await page.request.get(`${base}/api/deployment/`)).json();assert.equal(d.mode,'preview');assert.ok(!d.factory && !d.spot && !d.earnMON);
  for(const kind of ['spot','perps']){
    await page.goto(`${base}/app/?tab=${kind}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelectorAll('.t-book-row').length>3,{},{timeout:45000});
    assert.match(await page.locator('.t-environment').innerText(),/Mainnet.*view only/);
    if(kind==='spot') await page.getByRole('group',{name:'Chart view',exact:true}).getByRole('button',{name:'Price',exact:true}).click();
    const label=kind==='spot'?'MON / USDC historical closing prices':'BTC / AUSD historical candlesticks';
    await page.getByRole('img',{name:label,exact:true}).waitFor({timeout:30000});
    for(const interval of ['1h','4h','15m']){
      await page.getByRole('group',{name:'Candle interval'}).getByRole('button',{name:interval,exact:true}).click();
      await page.getByRole('img',{name:label,exact:true}).waitFor({timeout:30000});
    }
    await page.screenshot({path:`${out}/live-${kind}-desktop.png`,fullPage:true});
    for(const width of [1024,768,390]){
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${kind} overflow ${width}`);
    }
    await page.screenshot({path:`${out}/live-${kind}-mobile.png`,fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    checks.push(`${kind}: public book and historical chart loaded; interval controls work; no overflow at 1440/1024/768/390.`);
  }
  // A failed feed must clear previous prices and depth, not leave them looking live.
  await page.route('**/api/markets/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"offline"}'}));
  await page.waitForFunction(()=>document.querySelectorAll('.t-book-row').length===0,{},{timeout:20000});
  assert.equal(await page.locator('.t-stat strong').first().innerText(),'—');
  checks.push('Feed failure clears the displayed mark and book.');
  assert.equal((await page.request.get(`${base}/api/markets/?kind=invalid`)).status(),400);
  assert.equal((await page.request.post(`${base}/api/rpc/`,{data:{jsonrpc:'2.0',id:1,method:'eth_sendTransaction',params:[]}})).status(),503);
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/checks.json`,JSON.stringify({base,at:new Date().toISOString(),checks,errors},null,2));
  console.log(checks.join('\n'));
}finally{await browser.close();}
