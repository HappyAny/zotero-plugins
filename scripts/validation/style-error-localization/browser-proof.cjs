const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),style=path.join(root,'zotero-style-custom');
const out=path.join(root,'build/validation/style-error-localization');fs.mkdirSync(out,{recursive:true});
const acorn=require('acorn');
const {chromium}=require('playwright');
const read=file=>fs.readFileSync(path.join(style,file),'utf8');
const source=read('test/reader-assist.test.mjs');
const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});
const helpers=ast.body.filter(node=>node.type==='FunctionDeclaration'&&node.id.name==='memoryIO'||node.type==='VariableDeclaration'&&node.declarations.some(d=>['sent','para','paper','sizes'].includes(d.id.name))).map(node=>source.slice(node.start,node.end)).join('\n');
const node=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='fixture');
let fixture=source.slice(node.start,node.end);
const replace=(from,to)=>{assert.ok(fixture.includes(from),from);fixture=fixture.replace(from,to);};
replace("const {document:doc,window:win}=parseHTML('<html><head></head><body><div id=\"split-view\"></div></body></html>');","const doc=document,win=window;");
fixture=fixture.split('\n').filter(line=>!line.includes("define('getComputedStyle'")&&!line.includes('Element.prototype.getBoundingClientRect=')&&!line.includes("define('clearTimeout',id=>")).join('\n');
// The Node fixture replaces navigator on the same line as clearTimeout. Keep real browser timers and platform.
replace("const viewWin=parseHTML('<html><body></body></html>').window,viewDoc=viewWin.document;","const viewWin=window,viewDoc=document.implementation.createHTMLDocument('PDF fixture');");
replace("fs.readFileSync(new URL('../content/reader-assist.css',import.meta.url),'utf8')","readerCSS");
fixture=fixture.replaceAll('isMac:true','isMac:false');
const prelude=`const I18N=CustomStyleI18N,Strings=CustomStyleStrings,Assist=CustomStyleAssist,ReaderAssist=CustomStyleReaderAssist;
const realSetTimeout=window.setTimeout.bind(window),realClearTimeout=window.clearTimeout.bind(window);
const settle=async(n=8)=>{for(let i=0;i<n;i++)await new Promise(r=>realSetTimeout(r,0));};`;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,headless:true});
 const report={errors:[],externalRequests:[],checks:[]};
 const check=(name,pass)=>{assert.equal(pass,true,name);report.checks.push({name,pass});};
 try{
  for(const [locale,send,make,prefix]of [['zh-CN','发送','生成摘要','AI 服务响应错误：HTTP '],['en-US','Send','Make summary','The AI service returned an error: HTTP '],['ko-KR','보내기','요약 만들기','AI 서비스 응답 오류: HTTP ']]){
  const page=await browser.newPage({viewport:{width:1100,height:1100}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.route(/^https?:/,route=>{report.externalRequests.push(route.request().url());return route.abort();});
  await page.setContent('<html lang="zh-CN"><head></head><body style="margin:0;background:#eee;font:14px system-ui"><main id="split-view"><p>离线阅读器测试文档</p></main></body></html>');
  await page.addStyleTag({content:read('content/reader-assist.css')});
  for(const file of ['i18n','strings','failures','assist','read-aloud','paper-chat','paper-translate','paper-text','reader-assist'])await page.addScriptTag({content:read('src/'+file+'.js')});
  await page.evaluate(css=>globalThis.readerCSS=css,read('content/reader-assist.css'));
  await page.addScriptTag({content:prelude+'\n'+helpers+'\n'+fixture+'\nglobalThis.makeReaderFixture=fixture;'});
  await page.evaluate(async locale=>{globalThis.f=makeReaderFixture({locale,settings:{aiLanguage:'English'}});await f.open();},locale);
  const pane=page.locator('[data-sc-ra]');
  for(const status of [401,403,429,500,400]){
   await page.evaluate(status=>{f.aiReplies.push(()=>({status,response:{error:{message:'Fixture request rejected'}}}));f.panel().querySelector('.sc-ra-input').textContent='请用通俗语言解释所选段落，并说明它在论文论证中的作用。';},status);
   await pane.getByRole('button',{name:send,exact:true}).click();
   await page.waitForFunction(expected=>document.querySelector('.sc-ra-chat .sc-ra-note:last-child')?.textContent===expected,prefix+status);
   const statusText=await pane.locator('.sc-ra-chat .sc-ra-note').last().textContent();
   check(locale+' chat HTTP '+status+' uses the full localized sentence',statusText===prefix+status&&(locale==='ko-KR'||!/[가-힣]/.test(statusText)));
  }
  check(locale+' keeps the question ready for retry',await pane.locator('.sc-ra-input').textContent()==='请用通俗语言解释所选段落，并说明它在论文论证中的作用。'&&await pane.getByRole('button',{name:send,exact:true}).isEnabled());
  if(locale==='zh-CN')await pane.locator('.sc-ra-chat').screenshot({path:path.join(out,'chat-http400-chinese.png'),animations:'disabled'});
  await page.evaluate(()=>f.aiReplies.push(()=>({status:400,response:{}})));
  await pane.getByRole('button',{name:make,exact:true}).click();
  await page.waitForFunction(expected=>document.querySelector('.sc-ra-summary .sc-ra-error')?.textContent===expected,prefix+400);
  check(locale+' summary HTTP 400 uses the same localized sentence',await pane.locator('.sc-ra-summary .sc-ra-error').textContent()===prefix+400);
  check(locale+' keeps the summary retry control available',await pane.getByRole('button',{name:make,exact:true}).isVisible());
  await page.evaluate(()=>f.stop());
  await page.close();
  }
  check('the real reader fixture made no external requests and had no script errors',report.errors.length===0&&report.externalRequests.length===0);
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checks:report.checks.length,passed:true}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
