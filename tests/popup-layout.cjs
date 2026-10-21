// Exercise popup-sized viewports, scrolling and expanded settings in both engines.
// The browser API is a fixture: these checks validate layout, not Safari installation.
const {chromium, webkit} = require('playwright');
const fs=require('node:fs'), path=require('node:path'), http=require('node:http'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), ext=path.join(root,'extension');
const out=path.join(root,'.artifacts/popup-layout'); fs.mkdirSync(out,{recursive:true});
const config={enabled:true,online:false,order:'journal-year-title',aliases:{}};
const server=http.createServer((req,res)=>{
  const file=path.resolve(ext,'.'+new URL(req.url,'http://fixture').pathname);
  if(!file.startsWith(ext+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':file.endsWith('.png')?'image/png':'text/html; charset=utf-8');
  res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const reports=[];
  for(const [name,engine,safari] of [['Chrome for Testing',chromium,false],['WebKit Safari layout',webkit,true]]){
    const browser=await engine.launch({headless:true,...(safari?{}:{channel:'chromium'})});
    try{
      const page=await browser.newPage({viewport:{width:430,height:600}});
      await page.addInitScript(({safari,config,base})=>{
        const state={config,meta:{title:'A long Chinese and English paper title',year:'2024',journal:'Nature Medicine',abbreviation:'Nat Med',pdfUrls:[base+'/file.pdf']},tabId:1,pageUrl:base+'/',history:[],nativeDownloads:!safari};
        const api={runtime:{getURL:p=>(safari?'safari-web-extension:':'chrome-extension:')+'//fixture/'+p,sendMessage:async msg=>msg.type==='STATE'?structuredClone(state):({ok:true})},tabs:{sendMessage:async()=>({ok:true})}};
        if(safari) window.browser=api;else window.chrome=api;
      },{safari,config,base});
      await page.goto(base+'/popup.html');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已识别'));
      const checks=[];
      for(const width of [25,430,800]){
        await page.setViewportSize({width,height:600});
        const m=await page.evaluate(()=>({root:document.documentElement.getBoundingClientRect().width,body:document.body.getBoundingClientRect().width,h:document.body.clientHeight,overflow:document.body.scrollWidth>document.body.clientWidth}));
        assert.equal(m.root,430);assert.equal(m.body,430);assert.ok(m.h<=600);assert.equal(m.overflow,false);
        checks.push('fixed width from '+width+'px initial viewport');
      }
      await page.setViewportSize({width:430,height:600});
      await page.screenshot({path:path.join(out,safari?'webkit-top.png':'chrome-top.png')});
      await page.locator('details summary').first().click();
      await page.locator('#save-aliases').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#save-aliases').isVisible(),true);
      const inView=await page.locator('#save-aliases').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=600;});assert.ok(inView);
      await page.locator('details summary').last().click();await page.locator('#clear').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#clear').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=600;}));
      await page.screenshot({path:path.join(out,safari?'webkit-bottom.png':'chrome-bottom.png')});
      reports.push({browser:name,version:browser.version(),checks:[...checks,'expanded aliases reachable by scrolling','download history and clear button reachable'],actualExtensionPopup:false});
      console.log('PASS '+name+' popup layout and scrolling');
    }finally{await browser.close();}
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({date:new Date().toISOString().slice(0,10),reports},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
