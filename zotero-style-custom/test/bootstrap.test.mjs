import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// build.py writes the openly licensed build beside the source it came from, so a
// checkout that has not been built yet still finds the file under its own name.
const shipped=name=>{const open=path.join(root,'data',name.replace(/\.json$/,'.open.json'));
 return fs.existsSync(open)?open:path.join(root,'data',name);};
async function boot({failJCR=false,invalidJCR=false,licensed=null,version='0.8.0',extraFiles=null}={}){
 const prefs=new Map(),columns=new Map(),observers=new Map(),registered=new Set(),writes=[],errors=[],debug=[],loaded=[],attached=[],started=[],timers=[],resourceReads=[];let next=1;
 const Z={initializationPromise:Promise.resolve(),DataDirectory:{dir:'/isolated/data'},Libraries:{userLibraryID:1,get:()=>({editable:true})},Reader:{_readers:[]},getMainWindows:()=>[{testWindow:true}],getMainWindow:()=>null,debug:value=>debug.push(value),logError:e=>errors.push(e),
  Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v),registerObserver:(k,fn)=>{const id=next++;observers.set(id,{k,fn});return id;},unregisterObserver:id=>observers.delete(id)},
  ItemTreeManager:{registerColumn:c=>{assert.equal(typeof c.width,'string');const id=c.pluginID+'-'+c.dataKey;columns.set(id,c);return id;},unregisterColumn:id=>columns.delete(id)},
  PreferencePanes:{register:async()=> 'pane',unregister(){}},Notifier:{registerObserver:()=> 'item-observer',unregisterObserver(){}},
  // Packaged files are read through a channel: Zotero 10's HTTP.request throws on jar: URLs.
  File:{getResourceAsync:async url=>{const name=url.split('/').at(-1);resourceReads.push(name);assert.ok(['if-catalog.json','journal-registry.json','journal-catalog.json','manifest.json'].includes(name));
   if(name==='manifest.json')return fs.readFileSync(path.join(root,'manifest.json'),'utf8');
   if(name==='journal-catalog.json'&&failJCR)throw new Error('packaged catalog unavailable');
   if(name==='journal-catalog.json'&&invalidJCR)return JSON.stringify({schemaVersion:1,source:{provider:'OpenAlex'}});
   return fs.readFileSync(shipped(name),'utf8');}}
 };
 // The archive carries the openly licensed build of each table; a reader's own
 // licensed copy, when they have placed one, is read from the data directory.
 const local=new Map([
  ...Object.entries(licensed||{}).map(([name,value])=>['/isolated/data/style-custom-journals/'+name,JSON.stringify(value)]),
  ...Object.entries(extraFiles||{}).map(([p,value])=>[p,typeof value==='string'?value:JSON.stringify(value)])
 ]);
 const context=vm.createContext({Zotero:Z,console,URL,PathUtils:{join:(...p)=>p.join('/')},
  IOUtils:{exists:async p=>local.has(p),stat:async p=>({size:local.get(p).length}),readUTF8:async p=>local.get(p),writeUTF8:async(p,data,...rest)=>{local.set(p,data);writes.push([p,data,...rest]);},remove:async p=>{local.delete(p);}},pref:(k,v)=>prefs.set(k,v),setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){}});
 context.Services={scriptloader:{loadSubScript:(url,scope)=>{assert.equal(scope,vm.runInContext('globalThis',context));const name=url.split('/').at(-1);loaded.push(name);vm.runInContext(fs.readFileSync(path.join(root,'src',name),'utf8'),context,{filename:name});
  if(name==='runtime.js'){
   const prototype=vm.runInContext('CustomStyleRuntime.prototype',context),start=prototype.start;
   prototype.start=function(...args){started.push({catalog:this.jcrCatalog});return start.apply(this,args);};
   prototype.addWindow=function(window){attached.push({window,catalog:this.jcrCatalog});};
  }
 }},obs:{addObserver:o=>registered.add(o),removeObserver:o=>registered.delete(o)}};
 vm.runInContext(fs.readFileSync(path.join(root,'prefs.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(root,'bootstrap.js'),'utf8'),context);
 await vm.runInContext(`startup({id:'style-custom@sungjaeyoon.dev',version:${JSON.stringify(version)},rootURI:'file:///plugin/'})`,context);
 return {Z,context,columns,observers,registered,writes,errors,debug,loaded,attached,started,timers,resourceReads};
}
test('Gecko-like bootstrap defers heavy optional modules and shipped open catalog until requested without UI',async()=>{
 const {Z,context,columns,observers,registered,writes,errors,loaded,attached,started}=await boot();
 assert.equal(columns.size,29);assert.equal(typeof Z.StyleCustom.readerTools.setVerticalTabs,'function');assert.equal(registered.size,1);assert.equal(writes.length,0);
 // Heavy optional panels & self-check scripts (~1.82 MB) must stay unloaded at startup!
 for (const deferred of ['workbench.js','jcr-browser.js','selfcheck.js','selfcheck-reader.js','reader-assist.js','paper-text.js','read-aloud.js','paper-chat.js','paper-translate.js','paper-graph.js','reading-path.js','library.js','author-portrait.js','assist.js','library-facts.js','patents.js']) {
  assert.equal(loaded.includes(deferred), false, `${deferred} must not be loaded synchronously at startup`);
 }
 assert.equal(typeof Z.StyleCustom.libraryService.graph,'function');
 assert.equal(loaded.includes('library.js'), true, 'library.js loads on demand when libraryService is accessed');
 // On-demand Workbench access loads jcr-browser before workbench cleanly.
 assert.equal(Z.StyleCustom.Workbench.TABS.length,19);
 assert.ok(loaded.indexOf('jcr-categories.js')<loaded.indexOf('workbench.js'));assert.ok(loaded.indexOf('jcr-browser.js')<loaded.indexOf('workbench.js'));
 assert.equal(typeof Z.StyleCustom.jcrBrowser.mount,'function');
 // Shipped 28.7 MB OpenAlex category catalog stays unloaded at startup (0 MB / 0 ms) until Journals tab opens.
 assert.equal(Z.StyleCustom.jcrCatalog,null);
 assert.equal(typeof Z.StyleCustom.ensureJcrCatalog,'function');
 assert.equal(Z.StyleCustom.journalLayers['jcr-categories.json'],'shipped');
 assert.equal(started[0].catalog,null);assert.equal(attached[0].catalog,null);
 // On-demand load returns the exact openly licensed catalog.
 await Z.StyleCustom.ensureJcrCatalog();
 const packaged=JSON.parse(fs.readFileSync(shipped('journal-catalog.json'),'utf8'));
 assert.equal(Z.StyleCustom.jcrCatalog.groups.length,packaged.groups.length);
 assert.equal(Z.StyleCustom.jcrCatalog.categories.length,packaged.categories.length);
 assert.equal(Z.StyleCustom.jcrCatalog.source.provider,'OpenAlex');
 assert.match(String(Z.StyleCustom.jcrCatalog.source.license||Z.StyleCustom.jcrCatalog.source.licence||''),/CC0/i);
 assert.doesNotMatch(JSON.stringify(Z.StyleCustom.jcrCatalog.source),/clarivate/i);
 await vm.runInContext('shutdown()',context);assert.equal(columns.size,0);assert.equal(observers.size,0);assert.equal(registered.size,0);assert.equal(Z.StyleCustom,undefined);assert.equal(errors.length,0);
});

test("a reader's own licensed catalog wins over the one in the archive",async()=>{
 // The whole point of the split: a subscriber puts their Journal Citation Reports
 // export in the Zotero data directory and sees their own figures, while the
 // archive that reached them carries none.
 // Every value here is invented; only the shape is the real one.
 const licensed={'jcr-categories.json':{schemaVersion:1,
  source:{provider:'Clarivate',product:'JCR',url:'https://jcr.clarivate.com/jcr/browse-categories',capturedAt:'2026-09-20T05:47:13.287Z',complete:{groups:true,categories:true,journals:true}},
  groups:[{key:'G',name:'G',categoryCount:1,journalCount:1,citableItems:1,categoryKeys:['C']}],
  categories:[{key:'C',name:'C',groupKeys:['G'],editions:['SCIE'],journalCount:1,citableItems:1,totalCitations:1,medianJIF:1.5}],
  journals:[{key:'j1',title:'Journal of Invented Results',abbreviation:'J INVENT RES',issns:['0000-0019'],keyKind:'local-issn-and-exact-title',categoryKeys:['C'],editions:['SCIE'],jif:1.5,jifDisplay:'1.5',year:2026}]}};
 const {Z,context,errors}=await boot({licensed});
 assert.equal(Z.StyleCustom.jcrCatalog.source.provider,'Clarivate');
 assert.equal(Z.StyleCustom.jcrCatalog.journals.length,1);
 assert.equal(Z.StyleCustom.journalLayers['jcr-categories.json'],'local');
 await vm.runInContext('shutdown()',context);assert.equal(errors.length,0);
});

test('missing or invalid catalog data stays unavailable without substituting the journal registry',async()=>{
 for(const options of [{failJCR:true},{invalidJCR:true}]){
  const {Z,context,columns,errors,debug}=await boot(options);
  await Z.StyleCustom.ensureJcrCatalog();
  assert.equal(Z.StyleCustom.jcrCatalog,null);assert.ok(Z.StyleCustom.jcrCatalogError);assert.equal(columns.size,29);
  assert.ok(debug.some(message=>message.includes('journal category catalog not loaded')));
  assert.ok(vm.runInContext('CustomStyleJournalIdentity.registryRanked().length',context)>0,'the registry is still loaded');
  await vm.runInContext('shutdown()',context);assert.equal(errors.length,0);
 }
});

test('journal subset cache signature stays stable across code-only plugin patch updates',async()=>{
 const sampleIf=JSON.parse(fs.readFileSync(shipped('if-catalog.json'),'utf8')).slice(0,1);
 const subsetPayload={
  schema:1,
  signature:'open-v1|shipped|shipped',
  fullIfCount:100,
  fullRegistryCount:200,
  layers:{'if-catalog.json':'shipped','journal-registry.json':'shipped'},
  ifRecords:sampleIf,
  registryRows:[{title:'Nature',abbrev:'Nat',publisher:'Springer Nature'}],
  misses:[]
 };
 for(const ver of ['0.59.74','0.59.75']){
  const {Z,context,errors,resourceReads}=await boot({
   version:ver,
   extraFiles:{'/isolated/data/style-custom-journal-subset.json':subsetPayload}
  });
  assert.equal(resourceReads.includes('if-catalog.json'),false,`v${ver} must reuse hot subset without reading full if-catalog.json`);
  assert.equal(resourceReads.includes('journal-registry.json'),false,`v${ver} must reuse hot subset without reading full journal-registry.json`);
  assert.equal(Z.StyleCustom._journalSubset.active,true);
  await vm.runInContext('shutdown()',context);
  assert.equal(errors.length,0);
 }
});

test('cold workbench storage splits out of style-custom.json safely and stays unloaded on subsequent cold starts',async()=>{
 const sampleIf=JSON.parse(fs.readFileSync(shipped('if-catalog.json'),'utf8')).slice(0,1);
 const subsetPayload={
  schema:1,signature:'open-v1|shipped|shipped',fullIfCount:100,fullRegistryCount:200,
  layers:{'if-catalog.json':'shipped','journal-registry.json':'shipped'},
  ifRecords:sampleIf,registryRows:[{title:'Nature',abbrev:'Nat',publisher:'Springer Nature'}],misses:[]
 };
 // 1. Monolithic legacy style-custom.json migrates two-phase (cold written FIRST, then hot trimmed)
 const monolithic={
  schema:1,
  items:{'1:ABC':{seconds:120,metrics:{citations:42,citationSource:'OpenAlex works sweep',citationCheckedAt:'2026-11-01T00:00:00Z',citationKey:'doi:10.1/a'}}},
  works:{'1:ABC':{doi:'10.1/a',citations:42,checkedAt:'2026-11-01T00:00:00Z',references:['W1']}},
  journalMetrics:{nature:{if:50}}
 };
 const first=await boot({
  version:'0.59.76',
  extraFiles:{
   '/isolated/data/style-custom-journal-subset.json':subsetPayload,
   '/isolated/data/style-custom.json':monolithic
  }
 });
 assert.equal(first.Z.StyleCustom._pendingColdMigration,true);
 await vm.runInContext('shutdown()',first.context);
 assert.equal(first.errors.length,0);
 const writePaths=first.writes.map(w=>w[0]);
 const coldIdx=writePaths.indexOf('/isolated/data/style-custom-workbench.json');
 const hotIdx=writePaths.indexOf('/isolated/data/style-custom.json');
 assert.ok(coldIdx>=0,'cold workbench file must be written on migration');
 assert.ok(hotIdx>coldIdx,'cold file must commit BEFORE hot style-custom.json is trimmed');
 const writtenHot=JSON.parse(first.writes[hotIdx][1]);
 const writtenCold=JSON.parse(first.writes[coldIdx][1]);
 assert.equal(writtenHot.works,undefined,'trimmed style-custom.json must omit works');
 assert.equal(writtenHot.journalMetrics,undefined,'trimmed style-custom.json must omit journalMetrics');
 assert.equal(writtenHot.items['1:ABC'].seconds,120,'hot items stay intact');
 assert.deepEqual(writtenCold.works['1:ABC'].references,['W1'],'cold works preserved completely');
 assert.equal(writtenCold.journalMetrics.nature.if,50,'cold journalMetrics preserved completely');

 // 2. Next cold boot with split files keeps cold file UNLOADED at startup and loads on demand
 const second=await boot({
  version:'0.59.76',
  extraFiles:{
   '/isolated/data/style-custom-journal-subset.json':subsetPayload,
   '/isolated/data/style-custom.json':writtenHot,
   '/isolated/data/style-custom-workbench.json':writtenCold
  }
 });
 assert.equal(second.Z.StyleCustom._coldLoaded,false,'cold workbench file must stay unloaded at startup');
 assert.equal(second.Z.StyleCustom.cache.works,undefined,'works not parsed on startup');
 // Hot save while cold is unloaded must NOT overwrite cold file
 second.Z.StyleCustom.cache.items['1:ABC'].seconds=180;
 second.Z.StyleCustom.dirty=true;
 await second.Z.StyleCustom.flush();
 assert.equal(second.writes.some(w=>w[0]==='/isolated/data/style-custom-workbench.json'),false,'hot save must leave cold file untouched on disk');
 // On-demand load populates works & journalMetrics cleanly
 await second.Z.StyleCustom.ensureColdCache();
 assert.equal(second.Z.StyleCustom._coldLoaded,true);
 assert.deepEqual(Array.from(second.Z.StyleCustom.cache.works['1:ABC'].references),['W1']);
 assert.equal(second.Z.StyleCustom.cache.journalMetrics.nature.if,50);
 await vm.runInContext('shutdown()',second.context);
 assert.equal(second.errors.length,0);
});
