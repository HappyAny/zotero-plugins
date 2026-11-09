import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness, mockElement, paper} from './helpers/search-ui-harness.mjs';

function fixture(prefs={}) {
	 prefs.metricsHidden??=false;prefs.detailHidden??=false;
 const ui=uiHarness({prefs});ui.win.innerWidth=1600;ui.win.innerHeight=1000;
 Object.defineProperty(ui.get('main'),'clientWidth',{get:()=>ui.win.innerWidth-32});
 Object.defineProperty(ui.get('main'),'clientHeight',{get:()=>600});
 Object.defineProperty(ui.get('results'),'clientHeight',{get:()=>600});
 for(const [id,dimension,property,fallback] of [['left-sidebar','offsetWidth','width',250],['author-profiles','offsetHeight','--authors-height',192],['detail','offsetHeight','--detail-height',100]]) {
  Object.defineProperty(ui.get(id),dimension,{get:()=>parseFloat(ui.get(id).style[property])||fallback});
  ui.get(id).hidden=false;
 }
 ui.get('metrics').hidden=false;ui.get('author-panel').hidden=false;ui.get('author-profiles').appendChild(mockElement('article'));
 ui.setupSplitters();return ui;
}
const drag=(ui,id,dx,dy)=>{ui.get(id).emit('mousedown',{button:0,clientX:100,clientY:100});ui.emitDocument('mousemove',{clientX:100+dx,clientY:100+dy});ui.emitDocument('mouseup');};

test('pane dragging tracks total movement, saves sizes, and releases its drag shield',()=>{
 const ui=fixture();drag(ui,'vsplit',100,0);assert.equal(ui.get('left-sidebar').offsetWidth,350);assert.equal(ui.prefs.metricsWidth,350);
 drag(ui,'asplit',0,60);assert.equal(ui.get('author-profiles').offsetHeight,252);assert.equal(ui.prefs.authorProfilesHeight,252);
 drag(ui,'hsplit',0,-110);assert.equal(ui.get('detail').offsetHeight,210,'a short detail can grow beyond its natural height');assert.equal(ui.prefs.detailHeight,210);
 assert.equal(ui.get('hsplit').classList.contains('dragging'),false);assert.deepEqual(ui.errors,[]);
});

test('keyboard resizing and reset preserve the compact automatic detail mode',()=>{
 const ui=fixture();ui.get('hsplit').emit('keydown',{key:'ArrowUp'});assert.equal(ui.get('detail').offsetHeight,120);
 ui.get('asplit').emit('keydown',{key:'ArrowDown',shiftKey:true});assert.equal(ui.prefs.authorProfilesHeight,242);
 ui.get('hsplit').emit('keydown',{key:'Enter'});assert.equal(ui.prefs.detailHeight,0);assert.equal(ui.get('detail').hasAttribute('data-sized'),false);
 ui.get('asplit').emit('dblclick');assert.equal(ui.prefs.authorProfilesHeight,0);assert.equal(ui.get('author-profiles').hasAttribute('data-sized'),false);
 ui.get('vsplit').emit('dblclick');assert.equal(ui.get('left-sidebar').offsetWidth,250);
});

test('saved pane sizes restore with viewport bounds and hiding metrics keeps the sidebar width',()=>{
 const prefs={metricsWidth:1500,detailHeight:900,authorProfilesHeight:700};const ui=fixture(prefs);ui.restoreLayout();ui.clampPanes();
 assert.equal(ui.get('left-sidebar').offsetWidth,960);assert.equal(ui.get('detail').offsetHeight,352);assert.ok(ui.get('author-profiles').offsetHeight<=600&&ui.get('author-profiles').offsetHeight>=48);
 ui.win.innerWidth=800;ui.clampPanes();assert.equal(ui.get('left-sidebar').offsetWidth,396);ui.saveLayout();
 ui.get('metrics').hidden=true;ui.saveLayout();assert.equal(prefs.metricsWidth,396,'hidden width is not saved as zero');
 assert.equal(Number(ui.get('vsplit').getAttribute('aria-valuenow')),396);
});

test('releasing outside the app cancels pane dragging and non-primary buttons do not start it',()=>{
 const ui=fixture();ui.get('vsplit').emit('mousedown',{button:2,clientX:10,clientY:10});assert.equal(ui.get('vsplit').classList.contains('dragging'),false);
 ui.get('vsplit').emit('mousedown',{button:0,clientX:10,clientY:10});ui.emitDocument('mousemove',{clientX:50,clientY:10});ui.emitWindow('blur');
 assert.equal(ui.get('vsplit').classList.contains('dragging'),false);assert.equal(ui.prefs.metricsWidth,290);
 ui.emitDocument('mousemove',{clientX:500,clientY:10});assert.equal(ui.get('left-sidebar').offsetWidth,290,'no movement listener remains');
});

test('the sidebar remains resizable with metrics hidden and restores its new width',()=>{
 const prefs={metricsHidden:true,metricsWidth:250};const ui=fixture(prefs);ui.restoreLayout();
 assert.equal(ui.get('metrics').hidden,true);assert.equal(ui.get('left-sidebar').hidden,false);
 assert.equal(ui.get('vsplit').hidden,false,'the add card still has a resize grip');
 drag(ui,'vsplit',70,0);assert.equal(prefs.metricsWidth,320);assert.equal(prefs.metricsHidden,true);
 const reopened=fixture(prefs);reopened.restoreLayout();
 assert.equal(reopened.get('left-sidebar').offsetWidth,320);assert.equal(reopened.get('metrics').hidden,true);
 reopened.viewMenuItems().find(x=>x.label==='metricsToggle').run();
 assert.equal(reopened.get('metrics').hidden,false);assert.equal(reopened.get('left-sidebar').offsetWidth,320);
});

test('closing the empty hint preserves details, selection, saved sizes, and list focus',()=>{
 const ui=fixture({detailHeight:180});ui.restoreLayout();ui.setupDetailHint();ui.originalRenderDetail();
 ui.state.selected.add('kept');ui.get('detail-hint-close').emit('click');ui.saveLayout();
 assert.equal(ui.get('detail').hidden,true);assert.equal(ui.get('hsplit').hidden,true);
 assert.equal(ui.prefs.detailHintHidden,true);assert.equal(ui.prefs.detailHidden,false,'the actual detail feature stays enabled');
 assert.equal(ui.prefs.detailHeight,180);assert.deepEqual([...ui.state.selected],['kept']);
 assert.equal(mockElement.active,ui.get('table-wrap'),'arrows and Space return to the list');
 assert.equal(ui.viewMenuItems().find(x=>x.label==='detailToggle').check,true);
 assert.equal(ui.viewMenuItems().find(x=>x.label==='detailHintToggle').check,false);
 // Use the production renderer, not a visibility-only stand-in.
 ui.state.records=[paper('a',{title:'A chosen paper',abstract:'An abstract.'})];ui.state.detailKey='a';ui.originalRenderDetail();
 assert.equal(ui.get('detail').hidden,false);assert.equal(ui.get('detail-body').hidden,false);assert.equal(ui.get('hsplit').hidden,false);
 assert.equal(ui.get('d-title').textContent,'A chosen paper');assert.equal(ui.get('detail').style['--detail-height'],'180px');
 ui.state.detailKey=null;ui.originalRenderDetail();assert.equal(ui.get('detail').hidden,true);
 assert.deepEqual(ui.errors,[]);
});

test('hint dismissal survives reopening and View can restore it without changing the detail preference',()=>{
 const prefs={detailHeight:160,detailHintHidden:true};const ui=fixture(prefs);ui.restoreLayout();ui.originalRenderDetail();
 assert.equal(ui.get('detail').hidden,true);ui.saveLayout();assert.equal(prefs.detailHidden,false);
 const reopened=fixture(prefs);reopened.restoreLayout();reopened.originalRenderDetail();
 assert.equal(reopened.get('detail').hidden,true);
 reopened.viewMenuItems().find(x=>x.label==='detailHintToggle').run();
 assert.equal(reopened.get('detail').hidden,false);assert.equal(prefs.detailHintHidden,false);
 assert.equal(reopened.get('hsplit').hidden,true,'an empty hint has no resize grip');
 reopened.toggleDetail();assert.equal(reopened.get('detail').hidden,true);assert.equal(prefs.detailHidden,true);
 reopened.setDetailHintVisible(false);reopened.setDetailHintVisible(true);
 assert.equal(reopened.get('detail').hidden,true,'restoring the hint respects Details off');
 reopened.toggleDetail();assert.equal(reopened.get('detail').hidden,false);assert.equal(prefs.detailHidden,false);
 assert.equal(prefs.detailHeight,160);
});

test('preview close controls collapse the whole pane, retain selection, and allow reopening',async()=>{
 const ui=uiHarness({prefs:{detailHeight:180},search:async()=>[paper('a',{title:'A paper'}),paper('b')]});
 await ui.runSearch();ui.restoreLayout();ui.wireEvents();ui.state.focusKey='a';ui.state.selected.add('b');
 for(const control of ['d-close','dp-close','preview-btn','escape']){
  ui.openPreview(ui.state.records[0]);ui.originalRenderDetail();
  assert.equal(ui.get('detail').hidden,false);assert.equal(ui.state.preview.on,true);
  if(control==='escape')ui.onKeyDown({key:'Escape',preventDefault(){}});else ui.get(control).emit('click');
  assert.equal(ui.get('detail').hidden,true,control+' closes the complete detail pane');
  assert.equal(ui.state.preview.on,false);assert.equal(ui.state.detailKey,null);assert.equal(ui.state.focusKey,'a');
  assert.deepEqual([...ui.state.selected],['b']);assert.equal(mockElement.active,ui.get('table-wrap'));
  ui.saveLayout();assert.equal(ui.prefs.detailHidden,false,'temporary dismissal keeps Details enabled');
  assert.equal(ui.prefs.detailHeight,180);assert.equal(ui.get('preview-btn-label').textContent,'previewAction');
 }
 ui.state.detailKey='b';ui.originalRenderDetail();assert.equal(ui.get('detail').hidden,false,'choosing another paper reopens details');
 ui.setDetailVisible(false);ui.openPreview(ui.state.records[0]);ui.originalRenderDetail();
 assert.equal(ui.get('detail').hidden,false,'the Preview action can reopen a hidden detail feature');
 ui.closeDetail();assert.deepEqual(ui.errors,[]);
});

test('clicking the active Author search tab folds fields and cards without changing an active search or results',async()=>{
 const ui=uiHarness();ui.wireEvents();await ui.onAuthorModeClick();
 assert.equal(ui.searchMode(),'authors');assert.equal(ui.get('author-panel').hidden,false);
 ui.state.records=[paper('saved')];ui.state.selected.add('saved');ui.get('author-input').value='Example researcher';
 const controller=new AbortController();ui.state.searchController=controller;ui.state.searching=true;
 ui.get('mode-authors').emit('click');
 assert.equal(ui.get('author-panel').hidden,true);assert.equal(ui.get('mode-authors').getAttribute('aria-expanded'),'false');
 assert.equal(ui.get('mode-authors').getAttribute('aria-pressed'),'true');assert.equal(controller.signal.aborted,false);
 assert.equal(ui.state.records[0].key,'saved');assert.deepEqual([...ui.state.selected],['saved']);
 assert.equal(ui.get('author-input').value,'Example researcher');assert.equal(ui.prefs.authorPanelCollapsed,true);
 ui.get('mode-authors').emit('click');
 assert.equal(ui.get('author-panel').hidden,false);assert.equal(ui.get('mode-authors').getAttribute('aria-expanded'),'true');
 ui.state.searching=false;ui.setAuthorPanelCollapsed(true);
 await ui.switchSearchMode('papers');await ui.onAuthorModeClick();
 assert.equal(ui.get('author-panel').hidden,false,'entering Author search from another mode expands it');
 assert.equal(ui.state.records[0].key,'saved');assert.deepEqual([...ui.state.selected],['saved']);
 assert.deepEqual(ui.errors,[]);
});
