const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const out=path.join(root,'build/validation/language-switch');fs.mkdirSync(out,{recursive:true});
const {chromium}=require('playwright');
const receipt={errors:[],networkRequests:[],checks:[]};
const check=(name,value)=>{assert.equal(value,true,name);receipt.checks.push({name,pass:true});};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(5000);
  page.on('pageerror',e=>receipt.errors.push(e.message));
  await page.route(/^https?:/,route=>{receipt.networkRequests.push(route.request().url().split('?')[0]);return route.abort();});
  await page.setContent('<html><body style="font:14px system-ui;margin:24px"><div id="style-custom-settings-root"></div></body></html>');
  await page.addStyleTag({content:read('zotero-style-custom/content/preferences.css')});
  for(const file of ['i18n','strings','settings-schema','settings'])await page.addScriptTag({content:read('zotero-style-custom/src/'+file+'.js')});
  await page.evaluate(async()=>{
   CustomStyleI18N.load(CustomStyleStrings);CustomStyleI18N.use('zh-CN');
   window.values=Object.fromEntries(CustomStyleSettingsSchema.schema.settings.map(s=>[s.key,s.default]));values.language='zh-CN';
   window.writes=[];window.runtime={settingsSchema:CustomStyleSettingsSchema.schema,t:s=>CustomStyleI18N.t(s),getSetting:k=>values[k],
    async setSetting(k,v){writes.push([k,v]);values[k]=v;if(k==='language')CustomStyleI18N.use(v,{locale:'en-US'});return v;},
    getSettingsStatus:()=>({version:'fixture',readSeconds:12,recordReading:true,selectedTitle:'Original user title 身体 학위논문',citationStatus:'idle'})};
   window.pane=CustomStyleSettings.mount({document,runtime});await pane.ready;pane.selectCategory('menus');
   const draft=document.querySelector('[data-setting="aiModel"] input');draft.value='UNSAVED MODEL 身体';draft.dispatchEvent(new Event('input',{bubbles:true}));window.draft=draft;
   const secret=document.querySelector('[data-setting="openalexApiKey"] input');secret.value='UNSAVED SECRET';secret.dispatchEvent(new Event('input',{bubbles:true}));window.secret=secret;
  });
  check('Chinese settings initially visible',await page.locator('h2').textContent()==='Style Custom 设置');
  check('four visible language buttons replace the popup',await page.locator('.scs-language [role=radio]:visible').count()===4&&!(await page.locator('#scs-language').isVisible()));
  await page.locator('.scs-language [data-value="en-US"]').click();await page.waitForFunction(()=>!document.querySelector('[data-setting=language]').getAttribute('aria-busy')||document.querySelector('[data-setting=language]').getAttribute('aria-busy')==='false');
  check('English selection persists and updates the same page',await page.evaluate(()=>values.language==='en-US'&&document.querySelector('h2').textContent==='Style Custom settings'));
  check('help text and navigation switch to English',await page.locator('[data-setting=language] .scs-help').textContent().then(s=>s.includes('update immediately')));
  check('unsaved model and secret inputs are preserved without writes',await page.evaluate(()=>draft===document.querySelector('[data-setting=aiModel] input')&&draft.value==='UNSAVED MODEL 身体'&&secret.value==='UNSAVED SECRET'&&secret.type==='password'&&writes.every(([key])=>key==='language')));
  check('user title remains unmodified',await page.locator('.scs-live').textContent().then(s=>s.includes('Original user title 身体 학위논문')));
  await page.locator('.scs-language [data-value="en-US"]').focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>values.language==='zh-CN');
  check('keyboard switches back to Chinese',await page.locator('h2').textContent()==='Style Custom 设置');
  await page.locator('.scs-language [data-value="ko-KR"]').click();await page.waitForFunction(()=>values.language==='ko-KR');
  check('Korean is selectable',await page.locator('h2').textContent()==='Style Custom 설정');
  await page.locator('.scs-language [data-value=auto]').click();await page.waitForFunction(()=>values.language==='auto');
  check('Follow Zotero resolves an English app',await page.locator('h2').textContent()==='Style Custom settings');
  await page.screenshot({path:path.join(out,'style-language-english.png')});
  await page.evaluate(()=>pane.destroy());
  const markup=read('content/preferences.xhtml').replace(/html:/g,'').replace(/<(\/?)menulist\b/g,'<$1select').replace(/<\/?menupopup\b[^>]*>/g,'').replace(/<menuitem\b([^>]*)\/>/g,'<option $1></option>').replace(/<(label|checkbox|button)\b([^<>]*?)\/>/g,'<$1$2></$1>');
  await page.setContent('<html><body style="font:14px system-ui;margin:24px">'+markup+'<p id="foreign" data-i18n="prefTitle">OTHER PLUGIN</p></body></html>');
  await page.addStyleTag({content:'groupbox,vbox{display:block} hbox{display:flex;gap:10px;margin-block:8px} h2{font-size:20px} select,input,button{font:inherit}'});
  for(const file of ['i18n-zh','i18n'])await page.addScriptTag({content:read('content/'+file+'.js')});
  await page.evaluate(()=>{window.prefValues={'extensions.zotpop.language':'zh'};window.events=[];window.Zotero={locale:'en-US',ZotPoPI18N,Prefs:{get:key=>prefValues[key],set:(key,v)=>{prefValues[key]=v;}},getMainWindows:()=>[],logError:e=>{throw e;}};});
  await page.addScriptTag({content:read('src/zotpop.js')});
  await page.evaluate(()=>{Zotero.ZotPoP.showJcrStatus=()=>{};Zotero.ZotPoP.updateStatusText=()=>'';Zotero.ZotPoP._window={CustomEvent,dispatchEvent:e=>events.push(e.type)};Zotero.ZotPoP.localizePrefs(document);});
  check('ZotPoP initially displays Chinese',await page.locator('[data-i18n=prefTitle]').first().textContent().then(s=>s.includes('查找论文')));
  await page.locator('#zotpop-language').selectOption('en');
  check('ZotPoP immediately displays English after selecting it',await page.locator('[data-i18n=prefTitle]').first().textContent().then(s=>s.includes('Find papers')));
  check('ZotPoP persists language and notifies its open search view',await page.evaluate(()=>prefValues['extensions.zotpop.language']==='en'&&events.includes('zotpop-language-changed')));
  check('other plugins text is left alone',await page.locator('#foreign').textContent()==='OTHER PLUGIN');
  await page.screenshot({path:path.join(out,'zotpop-language-english.png')});
  assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.networkRequests,[]);
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }catch(error){fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({...receipt,error:String(error)},null,2));throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
