const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const out=path.join(root,'build/validation/sidebar-add');fs.mkdirSync(out,{recursive:true});
const {chromium}=require('playwright');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('content/ui.js');
const layout=source.slice(source.indexOf('\tfunction restoreLayout()'),source.indexOf('\tfunction applyColumnWidths()'));
const selects=source.slice(source.indexOf('\tfunction selButton('),source.indexOf('\tfunction debounce('));
const importBar=source.slice(source.indexOf('\tfunction syncImportBar()'),source.indexOf('\tfunction updateCounts()'));
assert.ok(layout.includes('function setupDetailHint()'));
const markup=read('content/search.xhtml').replace(/<\?xml[^>]*\?>/,'').replace(/<script\b[^>]*><\/script>/g,'').replace(/<link\b[^>]*>/g,'');
const receipt={errors:[],networkRequests:[],checks:[],measurements:[]};
const check=(name,pass)=>{assert.equal(pass,true,name);receipt.checks.push({name,pass});};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:2048,height:1106}});
  page.on('pageerror',e=>receipt.errors.push(e.message));
  await page.route(/^https?:/,route=>{receipt.networkRequests.push(route.request().url().split('?')[0]);return route.abort();});
  const mount=async(locale='en',prefs={})=>{
   await page.setContent(markup);await page.addStyleTag({content:read('content/search.css')});
   for(const file of ['i18n-zh','i18n','tooltip'])await page.addScriptTag({content:read('content/'+file+'.js')});
   await page.evaluate(({locale,prefs})=>{
    window.prefs=prefs;window.fixtureLocale=locale;
    const t=ZotPoPI18N.make(locale),$=id=>document.getElementById(id);
    for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n);
    for(const [attr,dest] of [['data-i18n-title','title'],['data-i18n-aria','aria-label']])for(const el of document.querySelectorAll('['+attr+']'))el.setAttribute(dest,t(el.getAttribute(attr)));
    $('query-form').hidden=true;$('author-panel').hidden=false;
    $('mode-authors').setAttribute('aria-pressed','true');$('mode-papers').setAttribute('aria-pressed','false');
    $('author-profiles').innerHTML=Array.from({length:8},(_,i)=>`<article class="author-profile"><div class="author-profile-info"><strong>Example researcher ${i+1}</strong><span class="author-profile-meta">University of Example · ORCID</span><span>385 papers · 17,586 citations</span></div><div class="author-profile-actions"><button>Load papers</button><button>Follow author</button></div></article>`).join('');
    $('asplit').hidden=false;
    $('metrics').innerHTML='<h3>Example researcher</h3>'+Array.from({length:20},(_,i)=>`<p>Yearly citations ${200+i}</p>`).join('');
    $('results-body').innerHTML=Array.from({length:40},(_,i)=>`<tr><td>□</td><td>Example photonics paper ${i+1}</td><td>Example researcher</td><td>2026</td></tr>`).join('');
    $('results-table').setAttribute('data-aff','');
    $('detail').setAttribute('data-empty','');
    $('detail-body').innerHTML='<div class="detail-head"><h3>Example paper details</h3></div><p>This is a fictional abstract for a layout test.</p>';
    $('target').innerHTML='<option value="library">My Library</option><option value="example">Example collection</option>';
    $('status').textContent=locale==='zh'?'显示 383 条已保存结果，未发送新请求。':'Showing 383 saved results; no new requests made.';
    $('selected-count').textContent=t('selected',0);
    $('opt-queue').checked=true;
   },{locale,prefs});
   await page.addScriptTag({content:`(()=>{
    const $=id=>document.getElementById(id),t=ZotPoPI18N.make(fixtureLocale);
    const PREF=function(key,value){if(arguments.length>1)prefs[key]=value;return prefs[key];};
    const state={colWidths:{},optsOpen:false},COL_VERSION=1,COL_VERSION_MIN_WIDTHS=1,COLUMN_KEYS=[],DEFAULT_COLS={};
    const log=message=>{throw new Error(message);},queueApi=()=>true,tip=ZotPoPTip.set;
    let openSel=null;
    const renderDetail=()=>{};
    ${layout}\n${selects}\n${importBar}
    restoreLayout();setupSplitters();setupDetailHint();enhanceSelect($('target'));syncImportBar();syncDetailSplitter();
    $('import-opts-toggle').addEventListener('click',()=>{state.optsOpen=!state.optsOpen;syncImportBar();});
    window.addEventListener('resize',clampPanes);
    window.demo={saveLayout,setDetailVisible,setDetailHintVisible,syncDetailSplitter,setMetricsVisible,
     choosePaper(on){$('detail').toggleAttribute('data-empty',!on);$('detail-empty').hidden=on;$('detail-body').hidden=!on;syncDetailSplitter();},
     selectMany(){ $('selected-count').textContent=t('selected',123);$('selected-only').hidden=false;$('selected-only').textContent=t('selectedOnly');$('import-btn').disabled=false;$('import-btn').querySelector('span').textContent=t('importBtnN',123);},
     stress(){ $('target').options[0].textContent='A very long destination collection name for the layout check';syncSel($('target'));$('opt-fillpdf').checked=true;$('opt-trnote').checked=true;syncImportBar();$('status').textContent='A long operation message: '.repeat(12);$('progress').hidden=false;}
    };
   })();`});
  };
  const sizes=()=>page.evaluate(()=>{
   const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const $=id=>document.getElementById(id),footer=rect($('import-bar'));
   const controls=['target-btn','import-opts-toggle','statusbar','selected-count','selected-only','import-btn'].filter(id=>!$(id).hidden).map(id=>({id,...rect($(id))}));
   let overlap=false;for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
    const a=controls[i],b=controls[j];if(Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1)overlap=true;
   }
   return {footer,sidebar:rect($('left-sidebar')),metrics:rect($('metrics')),main:rect($('main')),controls,overlap,hint:rect($('detail')),table:rect($('table-wrap')),contained:controls.every(r=>r.x>=footer.x&&r.right<=footer.right+1&&r.y>=footer.y&&r.bottom<=footer.bottom+1),tableMinimum:parseFloat(getComputedStyle($('table-wrap')).minHeight)};
  });
  const drag=async(id,dx)=>{const b=await page.locator('#'+id).boundingBox();assert.ok(b);const x=b.x+b.width/2,y=b.y+b.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:6});await page.mouse.up();};
  await mount();const before=await sizes();receipt.measurements.push({stage:'initial-sidebar',...before});
  check('the empty hint has a visible accessible close button',await page.getByRole('button',{name:'Hide shortcut hint',exact:true}).isVisible());
  check('the add card is below the metrics in the sidebar',before.footer.width===before.sidebar.width&&before.footer.y>=before.metrics.bottom&&before.footer.right<before.table.x);
  check('the add card is compact and anchored at the bottom',before.footer.width===250&&before.footer.height<=225&&Math.abs(before.footer.bottom-before.main.bottom)<2);
  check('the results use the full available main height',Math.abs(before.main.bottom-before.hint.bottom)<2);
  await page.locator('#target-btn').click();
  const menu=await page.locator('#target-list').boundingBox();
  check('the destination menu opens outside the scroll card and inside the window',await page.locator('#target-list').evaluate(el=>el.parentElement===document.body)&&menu.y>=0&&menu.y+menu.height<=1106);
  await page.getByRole('option',{name:'Example collection',exact:true}).click();
  check('the destination can still be changed from the compact card',await page.locator('#target').inputValue()==='example'&&await page.locator('#target-btn').textContent()==='Example collection');
  await page.getByRole('button',{name:'Hide shortcut hint',exact:true}).click();const closed=await sizes();
  check('closing the hint returns its space to the results',closed.hint.height===0&&closed.table.height>=before.table.height+before.hint.height);
  check('the list keeps keyboard focus',await page.evaluate(()=>document.activeElement.id==='table-wrap'));
  check('closing the hint keeps paper details enabled',await page.evaluate(()=>{demo.saveLayout();return prefs.detailHintHidden===true&&prefs.detailHidden===false;}));
  await page.evaluate(()=>demo.choosePaper(true));
  check('paper details and their resize grip remain available',await page.locator('#detail-body').isVisible()&&await page.locator('#hsplit').isVisible());
  await page.evaluate(()=>demo.choosePaper(false));check('returning to no paper keeps the hint dismissed',!(await page.locator('#detail').isVisible()));
  const saved=await page.evaluate(()=>({...prefs}));await mount('en',saved);
  check('dismissal survives a new page',!(await page.locator('#detail').isVisible()));
  await page.evaluate(()=>demo.setDetailHintVisible(true));
  check('the hint can be restored',await page.locator('#detail-hint-close').isVisible());
  await page.locator('#detail-hint-close').focus();await page.keyboard.press('Enter');
  check('the close button also works from the keyboard',!(await page.locator('#detail').isVisible()));
  await page.evaluate(()=>demo.selectMany());
  for(const width of [2048,1600,1280,1000,800,640]){
   await page.setViewportSize({width,height:1106});await page.waitForTimeout(35);const m=await sizes();receipt.measurements.push({stage:'selected-'+width,...m});
   check('sidebar controls remain contained and separate at '+width,m.contained&&!m.overlap);
   check('results retain at least four rows beside the add card at '+width,m.table.height>=m.tableMinimum-1&&m.footer.right<=m.table.x&&m.table.bottom<=m.main.bottom+1);
  }
  await page.setViewportSize({width:1600,height:1000});const initialWidth=(await sizes()).sidebar.width;
  await drag('vsplit',100);let m=await sizes();
  check('dragging resizes the metrics and add card together',m.sidebar.width>=initialWidth+99&&m.footer.width===m.sidebar.width&&m.metrics.width===m.sidebar.width);
  const resizedPrefs=await page.evaluate(()=>({...prefs}));await mount('en',resizedPrefs);
  check('the saved sidebar width restores',(await sizes()).sidebar.width===m.sidebar.width);
  await page.evaluate(()=>demo.setMetricsVisible(false));
  check('hiding metrics keeps the add controls and resize grip available',!(await page.locator('#metrics').isVisible())&&await page.locator('#import-btn').isVisible()&&await page.locator('#vsplit').isVisible());
  await page.locator('#vsplit').focus();await page.keyboard.press('ArrowRight');
  check('keyboard resizing works with metrics hidden',(await sizes()).sidebar.width>m.sidebar.width+19);
  await page.locator('#vsplit').dblclick();
  check('reset restores the compact sidebar width',(await sizes()).sidebar.width===250);
  await page.evaluate(()=>demo.setMetricsVisible(true));await page.evaluate(()=>demo.selectMany());
  await page.setViewportSize({width:1000,height:850});await page.waitForTimeout(35);await page.evaluate(()=>demo.stress());
  m=await sizes();check('long names, option summaries, status and progress remain contained',m.contained&&!m.overlap);
  check('the full option summary remains available to the hover card',await page.locator('#import-opts-toggle').evaluate(el=>el.getAttribute('data-tip')===el.textContent&&!el.hasAttribute('title')));
  const tableBefore=(await sizes()).table;await page.locator('#import-opts-toggle').click();m=await sizes();
  check('expanded options leave actions usable',await page.locator('#import-opts').isVisible()&&m.contained&&!m.overlap);
  check('opening options takes height from metrics and preserves result height',Math.abs(m.table.height-tableBefore.height)<2&&m.footer.right<=m.table.x);
  check('expanded options keep a readable metrics area',m.metrics.height>=64);
  check('long status text has its own scroll area',await page.locator('#status').evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=48));
  await page.screenshot({path:path.join(out,'narrow-options.png')});
  await page.setViewportSize({width:800,height:850});await drag('vsplit',-1000);m=await sizes();
  receipt.measurements.push({stage:'minimum-sidebar',...m});
  check('the minimum sidebar width contains controls horizontally',m.sidebar.width===140&&m.controls.every(r=>r.x>=m.footer.x&&r.right<=m.footer.right+1)&&!m.overlap);
  await page.locator('#opt-trnote').scrollIntoViewIfNeeded();await page.locator('#opt-trnote').uncheck();
  check('options can be scrolled and changed at minimum width',!(await page.locator('#opt-trnote').isChecked()));
  await page.locator('#import-btn').scrollIntoViewIfNeeded();
  m=await sizes();const action=m.controls.find(r=>r.id==='import-btn');
  check('the add action can be scrolled fully into a short narrow sidebar',action.y>=m.footer.y&&action.bottom<=m.footer.bottom&&await page.locator('#import-btn').isVisible());
  for(const [locale,label] of [['zh','隐藏快捷键提示'],['ko','단축키 안내 숨기기']]){
   await mount(locale);await page.getByRole('button',{name:label,exact:true}).click();
   check('localized hint closes in '+locale,!(await page.locator('#detail').isVisible()));
   await page.evaluate(()=>demo.selectMany());const local=(await sizes());
   check('localized add controls fit in '+locale,local.contained&&!local.overlap);
  }
  await page.setViewportSize({width:2048,height:1106});await mount('en',{detailHintHidden:true});
  await page.screenshot({path:path.join(out,'sidebar-add.png')});
  check('no script errors or network requests occurred',receipt.errors.length===0&&receipt.networkRequests.length===0);
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({checks:receipt.checks.length,passed:true,measurements:receipt.measurements.map(x=>({stage:x.stage,footerHeight:x.footer.height,tableHeight:x.table.height}))}));
 }catch(e){fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({...receipt,error:String(e)},null,2));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
