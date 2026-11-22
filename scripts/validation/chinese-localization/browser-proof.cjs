const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const acorn=require('acorn');
const root=path.resolve(__dirname,'../../..'),style=path.join(root,'zotero-style-custom');
const out=path.join(root,'build/validation/chinese-localization');fs.mkdirSync(out,{recursive:true});
const {chromium}=require('playwright');
const read=file=>fs.readFileSync(path.join(style,file),'utf8');
const demoSource=read('scripts/design-preview.mjs');
const ast=acorn.parse(demoSource,{ecmaVersion:'latest',sourceType:'module'});
const fn=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='mountDemo');
let demo=demoSource.slice(fn.start,fn.end);
const before='const bench=Workbench.attach(win,';
assert.ok(demo.includes(before));
demo=demo.replace(before,[
 'runtime.i18n=CustomStyleI18N;runtime.t=text=>CustomStyleI18N.t(text);',
 "runtime.pref=(key,fallback)=>key==='language'?'zh-CN':key==='aiLanguage'?'Simplified Chinese':fallback;",
 "runtime.getSetting=key=>runtime.pref(key,CustomStyleSettingsSchema.schema.settings.find(row=>row.key===key)?.default);",
 before
].join('\n'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,headless:true});
 const report={settings:{},workbench:[],errors:[],network:[]};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.route(/^https?:/,route=>{report.network.push(route.request().url().replace(/\?.*/,''));return route.abort();});
  await page.setContent('<html lang="zh-CN"><body style="margin:0;font:14px system-ui;background:#eef0f3"><div id="style-custom-settings-root"></div></body></html>');
  await page.addStyleTag({content:read('content/preferences.css')});
  for(const name of ['i18n','strings','settings-schema','settings'])await page.addScriptTag({content:read('src/'+name+'.js')});
  report.settings=await page.evaluate(async()=>{
   const i=CustomStyleI18N;i.load(CustomStyleStrings);i.use('zh-CN');
   const values=Object.fromEntries(CustomStyleSettingsSchema.schema.settings.map(s=>[s.key,s.default]));
   values.language='zh-CN';values.aiLanguage='Simplified Chinese';
   const runtime={t:text=>i.t(text),settingsSchema:CustomStyleSettingsSchema.schema,getSetting:key=>values[key],
    setSetting:async(key,value)=>{CustomStyleSettingsSchema.validate(key,value);values[key]=value;return value;},
    getSettingsStatus:()=>({version:'0.59.56',recordReading:true,selectedTitle:'Fixture paper',readSeconds:0,citationStatus:'待机'})};
   globalThis.settingsPane=CustomStyleSettings.mount({document,runtime});await settingsPane.ready;
   const leaks=[];
   for(const element of document.querySelectorAll('#style-custom-settings-root *')){
    for(const child of element.childNodes)if(child.nodeType===3&&/[가-힣]/.test(child.textContent))leaks.push(child.textContent);
    for(const key of ['title','aria-label','placeholder'])if(/[가-힣]/.test(element.getAttribute(key)||''))leaks.push(element.getAttribute(key));
   }
   return{rows:document.querySelectorAll('.scs-setting').length,korean:leaks,interfaceLanguage:values.language,aiLanguage:values.aiLanguage};
  });
  assert.equal(report.settings.rows,144);assert.deepEqual(report.settings.korean,[]);
  await page.screenshot({path:path.join(out,'settings-chinese.png')});
  await page.evaluate(()=>settingsPane.destroy());
  await page.setContent('<html lang="zh-CN"><head></head><body style="margin:0;background:#e5e7eb;font:14px system-ui"></body></html>');
  await page.addStyleTag({content:read('content/workbench.css')});
  for(const name of ['workspace','reading-path','paper-graph','journal-identity','reader-tools','workbench'])await page.addScriptTag({content:read('src/'+name+'.js')});
  await page.addScriptTag({content:demo+'\nglobalThis.mountChineseDemo=mountDemo;'});
  await page.evaluate(async()=>{globalThis.demo=await mountChineseDemo(window,CustomStyleWorkbench,CustomStyleWorkspace,CustomStyleReadingPath,CustomStylePaperGraph,CustomStyleJournalIdentity);});
  const nav=await page.locator('nav [data-tab]').allTextContents();
  assert.equal(nav.length,19);assert.ok(nav.every(s=>/[\u3400-\u9fff]/.test(s)),'Every workbench navigation label must be Chinese.');
  report.navigation=nav;
  const tabs=await page.locator('nav [data-tab]').evaluateAll(nodes=>nodes.map(n=>n.dataset.tab));
  for(const tab of tabs){
   await page.evaluate(async tab=>{await demo.bench.show(tab);},tab);
   const state=await page.evaluate(()=>{
    const panel=document.getElementById('style-custom-workbench');
    const ui=[...panel.querySelectorAll('button,input,select,summary,h1,h2,h3')].filter(n=>n.getClientRects().length);
    return{controls:ui.length,korean:ui.map(n=>n.textContent||n.getAttribute('aria-label')||'').filter(text=>/[가-힣]/.test(text)).slice(0,30)};
   });
   const fixtureText=new Set(['Fig. 3의 대조군 조건을 방법 절과 대조해 볼 것','연구 질문과 후속 확인','방법3','핵심 결과2','라이브러리']);
   state.preservedFixtureText=state.korean.filter(text=>fixtureText.has(text));
   state.interfaceLeaks=state.korean.filter(text=>!fixtureText.has(text));
   delete state.korean;
   assert.deepEqual(state.interfaceLeaks,[],'Untranslated interface text on '+tab);
   report.workbench.push({tab,...state});
   if(['explore','authors','appearance'].includes(tab))await page.screenshot({path:path.join(out,'workbench-'+tab+'-chinese.png')});
  }
  // The close CSS must still hide the panel root after adding a third locale.
  await page.setContent('<aside class="sc-ra"><button>关闭</button></aside>');
  await page.addStyleTag({content:read('content/reader-assist.css')});
  await page.evaluate(()=>document.querySelector('button').onclick=()=>document.querySelector('aside').hidden=true);
  await page.locator('button').click();
  assert.equal(await page.locator('aside').evaluate(n=>getComputedStyle(n).display),'none');
  report.assistantCloses=true;
  fs.writeFileSync(path.join(out,'browser-proof.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
