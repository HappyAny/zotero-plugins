const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const out=path.join(root,'build/validation/preview-fold');fs.mkdirSync(out,{recursive:true});
const {chromium}=require('playwright');
const acorn=require('acorn');
const source=read('content/ui.js'),functions=new Map();
const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration')functions.set(node.id.name,source.slice(node.start,node.end));for(const [key,value]of Object.entries(node)){if(key==='start'||key==='end')continue;if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}};
visit(acorn.parse(source,{ecmaVersion:'latest'}));
const lifecycle=['syncPreview','openPreview','closePreview','closeDetail','togglePreview','detailRecord','renderDetail','onKeyDown'].map(name=>{assert.ok(functions.has(name));return functions.get(name);}).join('\n');
const layout=source.slice(source.indexOf('\tfunction restoreLayout()'),source.indexOf('\tfunction applyColumnWidths()'));
const markup=read('content/search.xhtml').replace(/<\?xml[^>]*\?>/,'').replace(/<script\b[^>]*><\/script>/g,'').replace(/<link\b[^>]*>/g,'');
const receipt={errors:[],networkRequests:[],checks:[],measurements:[]};
const check=(name,pass)=>{assert.equal(pass,true,name);receipt.checks.push({name,pass});};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',e=>receipt.errors.push(e.message));
  await page.route(/^https?:/,route=>{receipt.networkRequests.push(route.request().url().split('?')[0]);return route.abort();});
  const mount=async(locale='en',prefs={})=>{
   await page.setContent(markup);await page.addStyleTag({content:read('content/search.css')});
   for(const file of ['i18n-zh','i18n','tooltip'])await page.addScriptTag({content:read('content/'+file+'.js')});
   await page.evaluate(({locale,prefs})=>{
    window.prefs=prefs;window.fixtureLocale=locale;
    const t=ZotPoPI18N.make(locale),$=id=>document.getElementById(id);
    for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n);
    for(const [attr,dest]of [['data-i18n-title','data-tip'],['data-i18n-aria','aria-label']])for(const el of document.querySelectorAll('['+attr+']'))el.setAttribute(dest,t(el.getAttribute(attr)));
    $('query-form').hidden=true;$('mode-authors').setAttribute('aria-pressed','true');$('mode-papers').setAttribute('aria-pressed','false');
    $('author-input').value='Example researcher';
    $('author-profiles').innerHTML=Array.from({length:5},(_,i)=>`<article class="author-profile"><div class="author-profile-info"><strong>Example researcher ${i+1}</strong><span class="author-profile-meta">University of Example · ORCID</span><span>385 fictional papers</span></div><div class="author-profile-actions"><button>Load papers</button><button>Follow author</button></div></article>`).join('');
    $('asplit').hidden=false;$('metrics').innerHTML='<h3>Fictional author metrics</h3>'+Array.from({length:12},(_,i)=>`<p>Yearly citations ${200+i}</p>`).join('');
    $('results-body').innerHTML=Array.from({length:12},(_,i)=>`<tr data-record="paper${i%2+1}">${Array.from({length:17},(_,k)=>`<td>${k===1?'Fictional photonics paper '+(i+1):k===2?'Example author':k===4?'2026':''}</td>`).join('')}</tr>`).join('');
    $('results-table').setAttribute('data-aff','');$('detail').setAttribute('data-empty','');
    $('preview-btn').disabled=false;$('target').innerHTML='<option>My Library</option>';
    $('import-opts-toggle').textContent=t('optsSummary',[t('optPdfShort')]);$('selected-count').textContent=t('selected',1);
    $('status').textContent='Offline fixture: no user library or network.';
   },{locale,prefs});
   await page.addScriptTag({content:`(()=>{
    const $=id=>document.getElementById(id),t=ZotPoPI18N.make(fixtureLocale),tip=ZotPoPTip.set;
    const PREF=function(key,value){if(arguments.length>1)prefs[key]=value;return prefs[key];};
    const state={records:[{key:'paper1',title:'Fictional photonics paper for preview controls',source:'openalex',authors:[],abstract:'Fictional abstract: this fixture tests layout and controls.'},{key:'paper2',title:'A second fictional paper',source:'openalex',authors:[],abstract:'A second fictional abstract.'}],selected:new Set(['paper2']),focusKey:'paper1',detailKey:null,preview:{on:false,key:null},libraryID:1,colWidths:{},searching:false,importing:false};state.visible=state.records;
    let searchSurface='authors',keysHelp=null,openTbMenu=null,openSel=null,escapeArmed=0;
    const switchSearchMode=async mode=>{searchSurface=mode;syncAuthorPanel();};
    const COL_VERSION=1,COL_VERSION_MIN_WIDTHS=1,COLUMN_KEYS=[],DEFAULT_COLS={},log=message=>{throw new Error(message);};
    const paintRows=()=>{},sourceLabel=key=>key,brandMark=()=>null,paintVenue=()=>{},renderCiteStrip=()=>{},buildResultContext=()=>({evidence:[],rest:[],authors:[]}),renderAuthors=()=>{},affiliationOf=()=>null;
    const paintAbstract=r=>{$('d-abstract').textContent=r.abstract;},renderVersions=()=>{},renderSignals=()=>{},renderReactions=async()=>{},renderWhy=()=>{},syncQueueButton=()=>{},fmt=String;
    const PREVIEW_FOLLOW_DELAY=0,ZotPoPPreview={originalURL:()=>null};let previewTimer=null,previewPending=null,viewerCloses=0;
    const previewViewer={close(){viewerCloses++;$('dp-canvas').textContent='';},showRecord(){const p=document.createElement('div');p.style.cssText='height:1500px;background:white;padding:40px;font-size:22px';p.textContent='Fictional PDF preview — no publisher request';$('dp-canvas').replaceChildren(p);$('dp-page').textContent='1 / 19';$('dp-message').hidden=true;}};
    const viewerOfPreview=()=>previewViewer,paintPreview=()=>{},previewRecord=()=>state.records.find(r=>r.key===(state.detailKey||state.focusKey))||null;
    ${layout}\n${lifecycle}
    restoreLayout();setupSplitters();setupDetailHint();syncAuthorPanel();renderDetail();
    $('mode-authors').addEventListener('click',onAuthorModeClick);
    $('d-close').addEventListener('click',closeDetail);$('dp-close').addEventListener('click',closeDetail);$('preview-btn').addEventListener('click',togglePreview);
    document.addEventListener('keydown',onKeyDown);window.addEventListener('resize',clampPanes);
    $('results-body').addEventListener('click',e=>{const row=e.target.closest('[data-record]');if(!row)return;state.focusKey=state.detailKey=row.dataset.record;renderDetail();});
    window.demo={state,openPreview,closeDetail,setDetailVisible,saveLayout,renderDetail,
     snapshot(){return {selected:[...state.selected],focus:state.focusKey,detail:state.detailKey,preview:state.preview.on,viewerCloses,input:$('author-input').value};},
     activeSearch(on){state.searching=on;if(on)state.searchController=new AbortController();},aborted(){return state.searchController?.signal.aborted;}
    };
   })();`});
  };
  const rect=async id=>page.locator('#'+id).evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height,width:r.width};});
  await mount('en',{detailHeight:180});let expanded=await rect('table-wrap'),authors=await rect('author-panel');
  await page.locator('#mode-authors').click();let collapsed=await rect('table-wrap');
  check('clicking Author search collapses its fields and cards',!(await page.locator('#author-panel').isVisible())&&await page.locator('#mode-authors').getAttribute('aria-expanded')==='false');
  check('collapsing authors gives their space to the results',collapsed.height>=expanded.height+authors.height-2);
  check('folding retains the author input, selection and active mode',await page.evaluate(()=>demo.snapshot().input==='Example researcher'&&demo.state.selected.has('paper2')&&document.getElementById('mode-authors').getAttribute('aria-pressed')==='true'&&prefs.authorPanelCollapsed===true));
  await page.locator('#mode-authors').click();
  check('a second click restores the author fields and cards',await page.locator('#author-panel').isVisible()&&await page.locator('#mode-authors').getAttribute('aria-expanded')==='true');
  await page.evaluate(()=>demo.activeSearch(true));await page.locator('#mode-authors').click();
  check('folding an active search does not abort it',await page.evaluate(()=>demo.state.searching&&!demo.aborted()));await page.evaluate(()=>demo.activeSearch(false));
  const saved=await page.evaluate(()=>({...prefs}));await mount('en',saved);
  check('the saved collapsed state restores on a new page',!(await page.locator('#author-panel').isVisible())&&await page.locator('#mode-authors').getAttribute('aria-expanded')==='false');
  await page.locator('#preview-btn').click();
  check('Preview opens the PDF pane with an accessible close cross',await page.locator('#d-pdfview').isVisible()&&await page.getByRole('button',{name:'Close details',exact:true}).isVisible());
  check('the toolbar Preview action changes to Close preview',await page.locator('#preview-btn-label').textContent()==='Close preview');
  const opened=await rect('table-wrap');await page.locator('#detail').evaluate(el=>el.scrollTop=el.scrollHeight);
  const cross=await rect('d-close'),detail=await rect('detail');
  check('the cross stays visible after scrolling details',cross.y>=detail.y&&cross.bottom<=detail.bottom&&cross.right<=detail.right);
  await page.getByRole('button',{name:'Close details',exact:true}).click();
  check('the cross collapses the whole detail pane and releases result space',!(await page.locator('#detail').isVisible())&&(await rect('table-wrap')).height>opened.height+100);
  check('closing retains selection and puts focus back in the list',await page.evaluate(()=>document.activeElement.id==='table-wrap'&&demo.state.selected.has('paper2')&&demo.state.focusKey==='paper1'&&demo.state.detailKey===null&&!demo.state.preview.on));
  await page.locator('#preview-btn').click();await page.locator('#dp-close').click();
  check('the Close preview control also collapses details',!(await page.locator('#detail').isVisible()));
  await page.keyboard.press('p');check('P can reopen preview from the focused list',await page.locator('#d-pdfview').isVisible());
  await page.keyboard.press('p');check('P can close the complete preview pane',!(await page.locator('#detail').isVisible()));
  await page.locator('#preview-btn').click();await page.locator('#table-wrap').focus();await page.keyboard.press('Escape');
  check('Escape closes the complete preview pane',!(await page.locator('#detail').isVisible()));
  await page.locator('[data-record="paper2"]').first().click();
  check('choosing another row reopens its normal details',await page.locator('#detail').isVisible()&&!(await page.locator('#d-pdfview').isVisible())&&await page.locator('#d-title').textContent()==='A second fictional paper');
  await page.evaluate(()=>demo.setDetailVisible(false));await page.locator('#preview-btn').click();
  check('Preview can reopen a detail pane disabled from View',await page.locator('#detail').isVisible()&&await page.locator('#d-pdfview').isVisible());
  await page.evaluate(()=>demo.saveLayout());check('saved detail height is retained',await page.evaluate(()=>prefs.detailHeight===180));
  for(const width of [1600,1000,760,640]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(30);await page.locator('#detail').evaluate(el=>el.scrollTop=el.scrollHeight);
   const c=await rect('d-close'),d=await rect('detail');receipt.measurements.push({stage:'preview-'+width,cross:c,detail:d});
   check('the close cross remains within the detail pane at '+width,c.x>=d.x&&c.right<=d.right&&c.y>=d.y&&c.bottom<=d.bottom);
  }
  await page.locator('#detail').evaluate(el=>{el.style.setProperty('--detail-height','60px');el.setAttribute('data-sized','');demo.renderDetail();el.scrollTop=el.scrollHeight;});
  let shortCross=await rect('d-close'),shortDetail=await rect('detail');
  check('the close cross remains usable at the minimum saved detail height',shortCross.y>=shortDetail.y&&shortCross.bottom<=shortDetail.bottom);
  await page.locator('#detail').evaluate(el=>{el.style.setProperty('--detail-height','180px');demo.renderDetail();});
  check('the compact toolbar action keeps its accessible close label',await page.locator('#preview-btn').getAttribute('aria-label')==='Close preview');
  await page.setViewportSize({width:1600,height:1000});await page.locator('#detail').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:path.join(out,'preview-close.png')});
  for(const [locale,close]of [['zh','关闭详情'],['ko','상세 닫기']]){
   await mount(locale,{detailHeight:180});await page.locator('#mode-authors').click();await page.locator('#preview-btn').click();
   check('the close cross has the correct label in '+locale,await page.getByRole('button',{name:close,exact:true}).isVisible());
   await page.getByRole('button',{name:close,exact:true}).click();
   check('the localized close cross collapses details in '+locale,!(await page.locator('#detail').isVisible()));
  }
  check('no script errors or network requests occurred',receipt.errors.length===0&&receipt.networkRequests.length===0);
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({checks:receipt.checks.length,passed:true}));
 }catch(e){fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({...receipt,error:String(e)},null,2));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
