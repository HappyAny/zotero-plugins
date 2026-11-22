const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const out=path.join(root,'build/validation/citation-key-layout');fs.mkdirSync(out,{recursive:true});
const {chromium}=require('playwright');
const legacy=fs.readFileSync(path.join(__dirname,'legacy-fix.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'zotero-style-custom/src/runtime.js'),'utf8');
const css=fs.readFileSync(path.join(root,'build/native-zotero/zotero.css'),'utf8');
const html=`<html><body><div id="zotero-item-pane"><info-box><div id="info-table">
<div class="meta-row"><div class="meta-label"><label>Title Translation</label></div><div class="meta-data"></div></div>
<div class="meta-row" data-custom-row-id="better-bibtex-citation-key"><div class="meta-label"><label>Citation Key</label></div><div class="meta-data"><editable-text class="value custom-row-value" value="researcherTerahertzRateKerrMicroresonator2019"><textarea rows="1" class="input">researcherTerahertzRateKerrMicroresonator2019</textarea></editable-text></div></div>
<div class="meta-row"><div class="meta-label"><label>Item Type</label></div><div class="meta-data">Journal Article</div></div>
<div class="meta-row"><div class="meta-label"><label>Title</label></div><div class="meta-data"><editable-text class="value" multiline fieldname="title" value="A fictional optical microresonator paper"><textarea rows="1" class="input">A fictional optical microresonator paper</textarea></editable-text></div></div>
<div class="meta-row" id="extra"><div class="meta-label"><label>Extra</label></div><div class="meta-data"><editable-text class="value" multiline fieldname="extra" value="Citations: 42"><textarea rows="1" class="input">Citations: 42</textarea></editable-text></div></div>
</div></info-box></div></body></html>`;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,headless:true});
 const report={errors:[],layoutSource:'CSS and editable-text markup from installed Zotero 10.0.8; fictional paper data.',trigger:'A temporary mismatch between field and row height, simulated with inline sizes.'};
 try{
  const page=await browser.newPage({viewport:{width:800,height:1000}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.setContent(html);
  await page.addStyleTag({content:css});
  await page.addStyleTag({content:'body{margin:24px;background:white;color:#16191f;font:16px/1.35 Arial,sans-serif}#zotero-item-pane{width:620px}info-box{display:block}editable-text{--line-height:1.35em;--editable-text-padding-block:3px;--editable-text-padding-inline:6px}.meta-row{box-sizing:border-box}.meta-label{padding-top:3px}.input{background:#f0f1f3!important}'});
  await page.addScriptTag({content:runtime+`\nglobalThis.legacyFix=({${legacy}}).fixItemPaneRows;globalThis.host=Object.create(CustomStyleRuntime.prototype);`});
  report.legacy=await page.evaluate(()=>{
   const row=document.querySelector('[data-custom-row-id]'),field=row.querySelector('editable-text');
   row.style.height='24px';field.style.height='1200px';
   const transient={row:row.getBoundingClientRect().height,field:field.getBoundingClientRect().height};
   const changed=legacyFix(document);
   row.style.removeProperty('height');field.style.removeProperty('height');
   legacyFix(document);
   return {transient,changed,row:row.getBoundingClientRect().height,field:field.getBoundingClientRect().height,minHeight:row.style.minHeight};
  });
  assert.equal(report.legacy.minHeight,'1200px');
  assert.ok(report.legacy.field>=1199,'the old minimum keeps the field stretched');
  await page.screenshot({path:path.join(out,'before.png')});
  report.fixed=await page.evaluate(()=>{
   const row=document.querySelector('[data-custom-row-id]'),field=row.querySelector('editable-text');
   row.style.removeProperty('min-height');
   row.style.height='24px';field.style.height='1200px';
   const value=field.getAttribute('value'),input=field.querySelector('textarea').value;
   const changed=host.fixItemPaneRows(document);
   row.style.removeProperty('height');field.style.removeProperty('height');
   for(let i=0;i<10;i++)host.fixItemPaneRows(document);
   return {changed,row:row.getBoundingClientRect().height,field:field.getBoundingClientRect().height,minHeight:row.style.minHeight,
    valuePreserved:field.getAttribute('value')===value&&field.querySelector('textarea').value===input};
  });
  assert.equal(report.fixed.changed,0);assert.equal(report.fixed.minHeight,'');assert.ok(report.fixed.field<80);assert.ok(report.fixed.valuePreserved);
  report.widths=[];
  for(const width of [620,400,280]){
   const measured=await page.evaluate(width=>{
    document.getElementById('zotero-item-pane').style.width=width+'px';
    host.fixItemPaneRows(document);
    const field=document.querySelector('[data-custom-row-id] editable-text');
    return {width,height:field.getBoundingClientRect().height};
   },width);
   assert.ok(measured.height>0&&measured.height<180);report.widths.push(measured);
  }
  await page.evaluate(()=>document.getElementById('zotero-item-pane').style.width='620px');
  report.extra=await page.evaluate(()=>{
   const row=document.getElementById('extra'),field=row.querySelector('editable-text');
   row.style.minHeight='20px';row.style.height='24px';field.style.height='124px';
   host.fixItemPaneRows(document);
   const expanded=row.style.minHeight;
   row.style.removeProperty('height');field.style.removeProperty('height');
   host.fixItemPaneRows(document);
   const released=row.style.minHeight;
   row.style.height='24px';field.style.height='124px';host.fixItemPaneRows(document);
   host.restoreItemPaneRows(document);
   return {expanded,released,restored:row.style.minHeight};
  });
  assert.equal(report.extra.expanded,'124px');assert.equal(report.extra.released,'20px');assert.equal(report.extra.restored,'20px');
  await page.evaluate(()=>{const row=document.getElementById('extra');row.style.removeProperty('height');row.querySelector('editable-text').style.removeProperty('height');});
  await page.screenshot({path:path.join(out,'after.png')});
  assert.deepEqual(report.errors,[]);
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
