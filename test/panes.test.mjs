import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness, mockElement} from './helpers/search-ui-harness.mjs';

function fixture(prefs={}) {
	 prefs.metricsHidden??=false;prefs.detailHidden??=false;
 const ui=uiHarness({prefs});ui.win.innerWidth=1600;ui.win.innerHeight=1000;
 Object.defineProperty(ui.get('main'),'clientWidth',{get:()=>ui.win.innerWidth-32});
 Object.defineProperty(ui.get('main'),'clientHeight',{get:()=>600});
 Object.defineProperty(ui.get('results'),'clientHeight',{get:()=>600});
 for(const [id,dimension,property,fallback] of [['metrics','offsetWidth','width',250],['author-profiles','offsetHeight','--authors-height',192],['detail','offsetHeight','--detail-height',100]]) {
  Object.defineProperty(ui.get(id),dimension,{get:()=>parseFloat(ui.get(id).style[property])||fallback});
  ui.get(id).hidden=false;
 }
 ui.get('author-panel').hidden=false;ui.get('author-profiles').appendChild(mockElement('article'));
 ui.setupSplitters();return ui;
}
const drag=(ui,id,dx,dy)=>{ui.get(id).emit('mousedown',{button:0,clientX:100,clientY:100});ui.emitDocument('mousemove',{clientX:100+dx,clientY:100+dy});ui.emitDocument('mouseup');};

test('pane dragging tracks total movement, saves sizes, and releases its drag shield',()=>{
 const ui=fixture();drag(ui,'vsplit',100,0);assert.equal(ui.get('metrics').offsetWidth,350);assert.equal(ui.prefs.metricsWidth,350);
 drag(ui,'asplit',0,60);assert.equal(ui.get('author-profiles').offsetHeight,252);assert.equal(ui.prefs.authorProfilesHeight,252);
 drag(ui,'hsplit',0,-110);assert.equal(ui.get('detail').offsetHeight,210,'a short detail can grow beyond its natural height');assert.equal(ui.prefs.detailHeight,210);
 assert.equal(ui.get('hsplit').classList.contains('dragging'),false);assert.deepEqual(ui.errors,[]);
});

test('keyboard resizing and reset preserve the compact automatic detail mode',()=>{
 const ui=fixture();ui.get('hsplit').emit('keydown',{key:'ArrowUp'});assert.equal(ui.get('detail').offsetHeight,120);
 ui.get('asplit').emit('keydown',{key:'ArrowDown',shiftKey:true});assert.equal(ui.prefs.authorProfilesHeight,242);
 ui.get('hsplit').emit('keydown',{key:'Enter'});assert.equal(ui.prefs.detailHeight,0);assert.equal(ui.get('detail').hasAttribute('data-sized'),false);
 ui.get('asplit').emit('dblclick');assert.equal(ui.prefs.authorProfilesHeight,0);assert.equal(ui.get('author-profiles').hasAttribute('data-sized'),false);
 ui.get('vsplit').emit('dblclick');assert.equal(ui.get('metrics').offsetWidth,250);
});

test('saved pane sizes restore with viewport bounds and hidden metrics keep their saved width',()=>{
 const prefs={metricsWidth:1500,detailHeight:900,authorProfilesHeight:700};const ui=fixture(prefs);ui.restoreLayout();ui.clampPanes();
 assert.equal(ui.get('metrics').offsetWidth,960);assert.equal(ui.get('detail').offsetHeight,352);assert.ok(ui.get('author-profiles').offsetHeight<=600&&ui.get('author-profiles').offsetHeight>=48);
 ui.win.innerWidth=800;ui.clampPanes();assert.equal(ui.get('metrics').offsetWidth,396);ui.saveLayout();
 ui.get('metrics').hidden=true;ui.saveLayout();assert.equal(prefs.metricsWidth,396,'hidden width is not saved as zero');
 assert.equal(Number(ui.get('vsplit').getAttribute('aria-valuenow')),396);
});

test('releasing outside the app cancels pane dragging and non-primary buttons do not start it',()=>{
 const ui=fixture();ui.get('vsplit').emit('mousedown',{button:2,clientX:10,clientY:10});assert.equal(ui.get('vsplit').classList.contains('dragging'),false);
 ui.get('vsplit').emit('mousedown',{button:0,clientX:10,clientY:10});ui.emitDocument('mousemove',{clientX:50,clientY:10});ui.emitWindow('blur');
 assert.equal(ui.get('vsplit').classList.contains('dragging'),false);assert.equal(ui.prefs.metricsWidth,290);
 ui.emitDocument('mousemove',{clientX:500,clientY:10});assert.equal(ui.get('metrics').offsetWidth,290,'no movement listener remains');
});
