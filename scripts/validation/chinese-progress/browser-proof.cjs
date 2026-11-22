const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),style=path.join(root,'zotero-style-custom');
const out=path.join(root,'build/validation/chinese-progress');fs.mkdirSync(out,{recursive:true});
const acorn=require('acorn');
const {chromium}=require('playwright');
const read=name=>fs.readFileSync(path.join(style,name),'utf8');
const source=read('scripts/design-preview.mjs');
const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});
const fn=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='mountDemo');
let demo=source.slice(fn.start,fn.end);
demo=demo.replace('Fig. 3의 대조군 조건을 방법 절과 대조해 볼 것','核对图 3 的对照组条件与方法部分是否一致');
const before='const bench=Workbench.attach(win,';
assert.ok(demo.includes(before));
demo=demo.replace(before,[
 'runtime.i18n=CustomStyleI18N;runtime.t=text=>CustomStyleI18N.t(text);',
 "runtime.pref=(key,fallback)=>key==='language'?'zh-CN':key==='aiLanguage'?'Simplified Chinese':fallback;",
 "runtime.backfillPending=async()=>({signals:825,journals:7,authors:2,files:3});",
 'runtime.runBackfill=options=>{globalThis.fillProgress=options.onProgress;return new Promise(resolve=>{globalThis.finishFill=resolve;});};',
 'runtime.backfillSummary=report=>CustomStyleRuntime.prototype.backfillSummary.call(runtime,report);',
 before
].join('\n'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,headless:true});
 const receipt={errors:[],networkRequests:[],button:[],background:[]};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>receipt.errors.push(e.message));
  await page.route(/^https?:/,route=>{receipt.networkRequests.push(route.request().url().split('?')[0]);return route.abort();});
  await page.setContent('<html lang="zh-CN"><body style="margin:0;background:#eef0f3;font:14px system-ui"></body></html>');
  await page.addStyleTag({content:read('content/workbench.css')});
  for(const name of ['i18n','strings','workspace','reading-path','paper-graph','journal-identity','reader-tools','runtime','workbench'])await page.addScriptTag({content:read('src/'+name+'.js')});
  await page.evaluate(()=>{CustomStyleI18N.load(CustomStyleStrings);CustomStyleI18N.use('zh-CN');});
  await page.addScriptTag({content:demo+'\nglobalThis.mountProgressDemo=mountDemo;'});
  await page.evaluate(async()=>{globalThis.demo=await mountProgressDemo(window,CustomStyleWorkbench,CustomStyleWorkspace,CustomStyleReadingPath,CustomStylePaperGraph,CustomStyleJournalIdentity);await demo.bench.show('explore');});
  await page.locator('.sc-notice-toggle').click();
  receipt.pending=await page.locator('.sc-notice-text').textContent();
  assert.doesNotMatch(receipt.pending,/[가-힣]/);
  await page.locator('.sc-notice-actions button').filter({hasText:'立即补齐'}).click();
  const expected=['附件类型','参考文献与作者机构','撤稿与开放获取状态','期刊指标','关注作者的新论文','关注作者的专利'];
  const stages=['files','works','signals','journals','authors','patents'];
  for(const [index,stage]of stages.entries()){
   await page.evaluate(stage=>fillProgress({stage,done:22,total:825}),stage);
   const status=await page.locator('.sc-status').textContent();
   assert.equal(status,`正在补齐 ${expected[index]} 23/825`);
   receipt.button.push({stage,status});
  }
  await page.evaluate(()=>{demo.runtime.windows=new Map([[window,{workbench:demo.bench}]]);});
  for(const [index,stage]of stages.entries()){
   await page.evaluate(stage=>CustomStyleRuntime.prototype.showBackfillProgress.call(demo.runtime,window,stage,22,825),stage);
   const status=await page.locator('.sc-status').textContent();
   assert.equal(status,`正在补齐 ${expected[index]} 23/825`);
   receipt.background.push({stage,status});
  }
  await page.evaluate(()=>CustomStyleRuntime.prototype.showBackfillProgress.call(demo.runtime,window,'signals',22,825));
  await page.screenshot({path:path.join(out,'progress-chinese.png')});
  await page.evaluate(()=>{finishFill({signals:{ok:23,'not-found':2,error:1},authors:{authors:2,withNews:0},budgetGone:false});});
  await page.waitForTimeout(30);
  receipt.completion=await page.locator('.sc-status').textContent();
  assert.match(receipt.completion,/撤稿与开放获取状态：已检查 23 项/);
  assert.doesNotMatch(receipt.completion,/[가-힣]/);
  await page.evaluate(()=>demo.bench.destroy());
  assert.deepEqual(receipt.errors,[]);
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
