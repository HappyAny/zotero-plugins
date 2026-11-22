/* Compare idle work in the production panel with a saved previous module.
 * This measures browser layout work and mock diagnostic writes, not PDF render speed. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const style=path.resolve(__dirname,'..'),repo=path.dirname(style),out=path.join(style,'build/reader-performance');
const acorn=require('acorn');
const {chromium}=require('playwright');
const read=file=>fs.readFileSync(path.join(style,file),'utf8');
fs.mkdirSync(out,{recursive:true});
const baseline=require('node:child_process').execFileSync('git',['show','b2b7a439d74bba3eb028e37d7bae24b8c66f8197:zotero-style-custom/src/reader-assist.js'],{cwd:repo,encoding:'utf8'});
const source=read('test/reader-assist.test.mjs'),ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});
const helpers=ast.body.filter(node=>node.type==='FunctionDeclaration'&&node.id.name==='memoryIO'||node.type==='VariableDeclaration'&&node.declarations.some(d=>['sent','para','paper','sizes'].includes(d.id.name))).map(node=>source.slice(node.start,node.end)).join('\n');
const node=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='fixture');
let fixture=source.slice(node.start,node.end);
const replace=(from,to)=>{assert.ok(fixture.includes(from),from);fixture=fixture.replace(from,to);};
replace('const {document:doc,window:win}=parseHTML(\'<html><head></head><body><div id="split-view"></div></body></html>\');','const doc=document,win=window;');
fixture=fixture.split('\n').filter(line=>!line.includes("define('getComputedStyle'")&&!line.includes('Element.prototype.getBoundingClientRect=')&&!line.includes("define('clearTimeout',id=>")).join('\n');
replace("const viewWin=parseHTML('<html><body></body></html>').window,viewDoc=viewWin.document;","const viewWin=window,viewDoc=document.implementation.createHTMLDocument('PDF fixture');");
replace("fs.readFileSync(new URL('../content/reader-assist.css',import.meta.url),'utf8')",'readerCSS');
fixture=fixture.replaceAll('isMac:true','isMac:false');
const prelude=`const I18N=CustomStyleI18N,Strings=CustomStyleStrings,Assist=CustomStyleAssist,ReaderAssist=CustomStyleReaderAssist;
const realSetTimeout=window.setTimeout.bind(window),realClearTimeout=window.clearTimeout.bind(window);
const settle=async(n=8)=>{for(let i=0;i<n;i++)await new Promise(r=>realSetTimeout(r,0));};`;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,headless:true});
 const report={scope:'60 repeated idle sync calls in a headless browser using production panel modules and an offline document fixture. No real PDF rendering or live Zotero interaction.',errors:[],externalRequests:[],cases:{},checks:[]};
 const check=(name,pass)=>{report.checks.push({name,pass});assert.equal(pass,true,name);};
 try{
  for(const variant of ['before','after']){
   const page=await browser.newPage({viewport:{width:1200,height:900}});
   page.on('pageerror',error=>report.errors.push(error.message));
   await page.route(/^https?:/,route=>{report.externalRequests.push(route.request().url());return route.abort();});
   await page.setContent('<html><head><style>body{margin:0}#split-view{position:absolute;inset:0;background:#eee}</style></head><body><main id="split-view"><p>Offline PDF view fixture</p></main></body></html>');
   await page.addStyleTag({content:read('content/reader-assist.css')});
   for(const name of ['i18n','strings','failures','assist','read-aloud','paper-chat','paper-translate','paper-text','reader-assist'])await page.addScriptTag({content:(name==='reader-assist'&&variant==='before'?baseline:read('src/'+name+'.js'))});
   await page.evaluate(css=>globalThis.readerCSS=css,read('content/reader-assist.css'));
   await page.addScriptTag({content:prelude+'\n'+helpers+'\n'+fixture+'\nglobalThis.makeReaderFixture=fixture;'});
   await page.evaluate(async()=>{
    globalThis.metrics={geometryReads:0,styleWrites:0,diagnosticWrites:0};
    const rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){metrics.geometryReads++;return rect.call(this);};
    const set=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(...args){metrics.styleWrites++;return set.apply(this,args);};
    const remove=CSSStyleDeclaration.prototype.removeProperty;CSSStyleDeclaration.prototype.removeProperty=function(...args){metrics.styleWrites++;return remove.apply(this,args);};
    globalThis.f=makeReaderFixture({holdTimers:true});f.Z.File={putContentsAsync:async()=>{metrics.diagnosticWrites++;}};f.Z.Prefs.set=()=>{};
    await f.open();await f.fire();await new Promise(resolve=>realSetTimeout(resolve,100));await f.fire();
    metrics.geometryReads=metrics.styleWrites=metrics.diagnosticWrites=0;
   });
   report.cases[variant]=await page.evaluate(async()=>{
    for(let i=0;i<60;i++){await f.sync();await f.fire();}
    const panel=f.panel().getBoundingClientRect(),view=document.querySelector('#split-view').getBoundingClientRect();
    // Exclude the two assertions' own geometry reads from the idle counters.
    return {...metrics,geometryReads:metrics.geometryReads-2,columnBeside:view.right<=panel.left+2,cycles:60};
   });
   check(variant+' keeps the panel beside the document',report.cases[variant].columnBeside);
   if(variant==='after'){
    check('container replacement is repaired without a periodic tick',await page.evaluate(async()=>{
     const old=document.querySelector('#split-view'),next=document.createElement('main');next.id='split-view';old.replaceWith(next);
     await new Promise(resolve=>realSetTimeout(resolve,120));return next.style.getPropertyValue('inset-inline-end')==='372px';
    }));
    check('native style reset is repaired without a periodic tick',await page.evaluate(async()=>{
     const view=document.querySelector('#split-view');view.style.removeProperty('inset-inline-end');await new Promise(resolve=>realSetTimeout(resolve,120));return view.style.getPropertyValue('inset-inline-end')==='372px';
    }));
    await page.setViewportSize({width:450,height:900});
    await page.waitForFunction(()=>{
     const panel=document.querySelector('[data-sc-ra]'),view=document.querySelector('#split-view');
     if(!panel||!view)return false;
     const box=panel.getBoundingClientRect(),paper=view.getBoundingClientRect();
     return panel.getAttribute('data-collapsed')==='true'&&Math.abs(box.width-52)<2&&paper.right<=box.left+2&&paper.width>=360;
    },null,{timeout:5000});
    report.narrow=await page.evaluate(()=>{const view=document.querySelector('#split-view').getBoundingClientRect(),panel=f.panel().getBoundingClientRect();return {viewportWidth:window.innerWidth,documentWidth:document.documentElement.clientWidth,sessionWidth:f.sessionOf().doc.documentElement.clientWidth,layoutKey:f.sessionOf().layoutSnapshot.key,collapsed:f.panel().getAttribute('data-collapsed'),viewRight:view.right,panelLeft:panel.left,panelWidth:panel.width,viewWidth:view.width};});
    check('a narrow reader folds the panel and preserves document space',report.narrow.collapsed==='true'&&report.narrow.viewRight<=report.narrow.panelLeft+2&&Math.abs(report.narrow.panelWidth-52)<2&&report.narrow.viewWidth>=360);
    await page.setViewportSize({width:1200,height:900});
    await page.waitForFunction(()=>{
     const panel=document.querySelector('[data-sc-ra]'),view=document.querySelector('#split-view');
     if(!panel||!view)return false;
     const box=panel.getBoundingClientRect(),paper=view.getBoundingClientRect();
     return panel.getAttribute('data-collapsed')==='false'&&Math.abs(box.width-372)<2&&paper.right<=box.left+2;
    },null,{timeout:5000});
    check('restoring the window width restores the expanded panel',await page.evaluate(()=>{const view=document.querySelector('#split-view').getBoundingClientRect(),panel=f.panel().getBoundingClientRect();return f.panel().getAttribute('data-collapsed')==='false'&&view.right<=panel.left+2&&Math.abs(panel.width-372)<2;}));
    await page.screenshot({path:path.join(out,'panel-after.png')});
   }
   await page.evaluate(()=>f.stop());await page.close();
  }
  check('baseline reproduces repeated geometry reads',report.cases.before.geometryReads>60);
  check('baseline reproduces repeated diagnostic writes',report.cases.before.diagnosticWrites===60);
  check('unchanged sync does not measure geometry',report.cases.after.geometryReads===0);
  check('unchanged sync does not write styles',report.cases.after.styleWrites===0);
  check('unchanged sync does not write diagnostics',report.cases.after.diagnosticWrites===0);
  check('no external requests or browser script errors',!report.externalRequests.length&&!report.errors.length);
  console.log(JSON.stringify({cases:report.cases,checks:report.checks.length}));
 }finally{fs.writeFileSync(path.join(out,'browser-benchmark.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
