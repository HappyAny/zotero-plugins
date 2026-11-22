import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
const require = createRequire(import.meta.url);
const Runtime = require('../src/runtime.js');
const Model = require('../src/data.js');
const settle = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
const binding = () => {
  const listeners = new Set();
  return {listeners, addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: () => {for (const fn of listeners) fn();}};
};

function fixture() {
  const Z = {Prefs: {get: () => undefined}, Libraries: {get: () => ({editable: true})}, logError(error) {throw error;}};
  const plugin = new Runtime({Zotero: Z, model: Model, storage: {write: async () => {}}, marquee: {}, reading: {}});
  plugin.active = true;
  for (const name of ['attachMotion', 'attachColumnFit', 'attachCells', 'watchItemPane', 'buildMenus']) plugin[name] = () => {};
  plugin.readerTools = {attach: () => () => {}, tabs: () => [], stop() {}};
  plugin.collectionCounts = {attach: () => () => {}, stop() {}};
  plugin.Workbench = {attach: () => ({refreshReading() {}, destroy() {}})};
  plugin.enhanceTitles = () => {};
  plugin.flush = async () => {};
  plugin.featureEnabled = () => false;
  plugin.pref = (_key, fallback) => fallback;
  plugin.state = item => ({citations: item.citations, rating: 4, seconds: 0, lastRead: ''});
  const items = Array.from({length: 300}, (_, id) => ({id, libraryID: 1, key: 'K' + id,
    citations: 1, isRegularItem: () => true}));
  let next = 0;
  function window() {
    const {document} = parseHTML('<html><body><input id="search"><div id="zotero-items-tree"></div></body></html>');
    const host = document.querySelector('#zotero-items-tree');
    host.scrollTop = 0; host.scrollLeft = 0;
    const timers = new Map(), selected = new Set([2]), calls = {refresh: 0, cache: 0, repaint: 0};
    let first = 0, cachedValue = 1;
    const context = binding();
    const view = {collectionTreeRow: {id: 'C1'}, getRow: index => ({ref: items[index]}),
      onSelect: binding(), rowProvider: {onUpdate: binding()},
      selection: {focused: 2, selected, selectEventsSuppressed: false},
      async refreshAndMaintainSelection() {
        calls.refresh++;
        // Native Zotero restores selection with ensureRowsAreVisible=true.
        host.scrollTop = this.selection.focused * 30;
      },
      invalidateRowCache(all) {assert.equal(all, true); calls.cache++; cachedValue = null;},
      tree: {invalidate() {calls.repaint++; if (cachedValue === null) cachedValue = items[first].citations;
        const cell = host.querySelector('.citations'); if (cell) cell.textContent = String(cachedValue);}},
    };
    function visible(start) {
      first = start;
      host.innerHTML = Array.from({length: 6}, (_, i) => `<div class="row" id="item-tree-main-row-${start + i}"><span class="citations">${items[start + i].citations}</span></div>`).join('');
    }
    visible(0);
    const win = {document, closed: false, ZoteroPane: {itemsView: view, collectionsView: {onSelect: context}},
      addEventListener() {}, removeEventListener() {},
      MutationObserver: document.defaultView.MutationObserver,
      setInterval() {assert.fail('the item list must not create a recurring timer');},
      setTimeout(fn) {const id = ++next; timers.set(id, fn); return id;},
      clearTimeout(id) {timers.delete(id);}};
    plugin.addWindow(win);
    const tick = async () => {await settle();for (const [id, fn] of [...timers]) {timers.delete(id);await fn();} await settle();};
    return {win, view, host, calls, timers, visible, tick, selected, context};
  }
  return {plugin, items, window, Z};
}

test('scrolling to different visible papers cannot trigger the five-second selection refresh', async () => {
  const f = fixture(), w = f.window(); await settle();
  w.visible(160); w.host.scrollTop = 4817; w.host.scrollLeft = 175;
  await w.tick();
  assert.equal(w.host.scrollTop, 4817, 'keep the viewed papers even when the selected paper is off-screen');
  assert.equal(w.host.scrollLeft, 175); assert.equal(w.calls.refresh, 0);
  assert.deepEqual([...w.selected], [2]); assert.equal(w.view.selection.focused, 2);
  await f.plugin.stop();
});

test('repeated scroll and periodic title updates never move the viewport or selection', async () => {
  const f = fixture(), w = f.window(); await settle();
  for (let i = 0; i < 12; i++) {
    w.visible(20 + 10 * i); w.host.scrollTop = 600 + 300 * i + 11;
    w.host.scrollLeft = 30 * i;
    await w.tick();
    assert.equal(w.host.scrollTop, 600 + 300 * i + 11); assert.equal(w.host.scrollLeft, 30 * i);
  }
  assert.equal(w.calls.refresh, 0); assert.deepEqual([...w.selected], [2]);
  await f.plugin.stop(); assert.equal(w.timers.size, 0);
});

test('background metrics invalidate cached cell values without reselecting or scrolling the list', async () => {
  const f = fixture(), w = f.window(); await settle();
  w.visible(180); w.host.scrollTop = 5419; w.host.scrollLeft = 240;
  w.selected.add(4); f.items[180].citations = 42;
  await f.plugin.refreshWindows();
  assert.equal(w.host.querySelector('.citations').textContent, '42', 'the updated value is actually repainted');
  assert.equal(w.calls.cache, 1); assert.equal(w.calls.repaint, 1); assert.equal(w.calls.refresh, 0);
  assert.equal(w.host.scrollTop, 5419); assert.equal(w.host.scrollLeft, 240);
  assert.deepEqual([...w.selected], [2, 4]); assert.equal(w.view.selection.selectEventsSuppressed, false);
  await f.plugin.stop();
});

test('each window keeps its own position and a closed window is not repainted', async () => {
  const f = fixture(), a = f.window(), b = f.window(); await settle();
  a.visible(100); a.host.scrollTop = 3000; b.visible(200); b.host.scrollTop = 6000;
  await f.plugin.refreshWindows();
  assert.equal(a.host.scrollTop, 3000); assert.equal(b.host.scrollTop, 6000);
  b.win.closed = true; await f.plugin.refreshWindows();
  assert.equal(a.calls.repaint, 2); assert.equal(b.calls.repaint, 1);
  await f.plugin.stop();
});

test('a loading or replaced item tree is not forced back to its previous collection', async () => {
  const f = fixture(), w = f.window(); await settle();
  const oldView = w.view;
  w.win.ZoteroPane.itemsView = {collectionTreeRow: {id: 'C2'}};
  await f.plugin.refreshWindows();
  assert.equal(oldView.calls, undefined); assert.equal(w.calls.refresh, 0); assert.equal(w.calls.repaint, 0);
  await f.plugin.stop();
});

test('list events coalesce bursts and leave no idle scan or decoration feedback loop', async () => {
  const f = fixture(), w = f.window(); let paints = 0, last = [];
  f.plugin.enhanceTitles = (_win, _state, records) => {
    paints++; last = records.map(item => item.id);
    // A deliberately non-idempotent decoration must not trigger itself again.
    const own = w.win.document.createElement('span'); own.textContent = String(paints);
    w.host.querySelector('.row').append(own);
  };
  await w.tick(); assert.equal(paints, 1); assert.equal(w.timers.size, 0);
  for (let i = 0; i < 100; i++) await w.tick();
  assert.equal(paints, 1, 'no work until an actual event occurs');
  w.visible(160);
  for (let i = 0; i < 50; i++) w.host.dispatchEvent(new w.win.document.defaultView.Event('scroll', {bubbles: true}));
  await settle(); assert.equal(w.timers.size, 1);
  await w.tick(); assert.equal(paints, 2); assert.deepEqual(last, [160,161,162,163,164,165]);
  assert.equal(w.timers.size, 0, 'our own DOM writes never feed the observer');
  await f.plugin.stop();
});

test('native context and row events rebind after tree replacement and detach on teardown', async () => {
  const f = fixture(), w = f.window(); let contexts = 0, paints = 0;
  const unsubscribe = f.plugin.subscribeLibraryContext(w.win, () => contexts++);
  f.plugin.enhanceTitles = () => paints++;
  await w.tick(); w.context.emit(); w.view.rowProvider.onUpdate.emit();
  await w.tick(); assert.equal(contexts, 1); assert.equal(paints, 2);
  const next = binding(), nextSelection = binding();
  w.win.ZoteroPane.collectionsView = {onSelect: next};
  w.win.ZoteroPane.itemsView = {...w.view, onSelect: nextSelection};
  const newRoot = w.host.cloneNode(true); w.host.replaceWith(newRoot);
  await w.tick(); assert.equal(w.context.listeners.size, 0); assert.equal(w.view.onSelect.listeners.size, 0);
  next.emit(); await w.tick(); assert.equal(contexts, 2);
  unsubscribe(); next.emit(); await w.tick(); assert.equal(contexts, 2);
  await f.plugin.stop(); assert.equal(next.listeners.size, 0); assert.equal(nextSelection.listeners.size, 0);
  assert.equal(w.timers.size, 0); next.emit(); assert.equal(w.timers.size, 0);
});

test('automatic visible citations require the feature, preference and key', async () => {
  const f = fixture(), w = f.window(); let requests = 0, key = '', enabled = true, automatic = true;
  f.plugin.featureEnabled = () => enabled;
  f.plugin.pref = (name, fallback) => name === 'autoCitations' ? automatic : fallback;
  f.plugin.openAlexKey = () => key;
  f.plugin.refreshCitations = async () => {requests++;};
  await w.tick(); assert.equal(requests, 0);
  key = 'test-key'; automatic = false; w.context.emit(); await w.tick(); assert.equal(requests, 0);
  automatic = true; enabled = false; w.context.emit(); await w.tick(); assert.equal(requests, 0);
  enabled = true; w.context.emit(); await w.tick(); assert.equal(requests, 1);
  for (let i = 0; i < 30; i++) await w.tick(); assert.equal(requests, 1);
  await f.plugin.stop();
});

test('papers entering view during a citation job are checked when that job finishes', async () => {
  const f = fixture(), w = f.window(), batches = [], checked = new Set(); let release;
  const gate = new Promise(resolve => {release = resolve;});
  f.plugin.featureEnabled = () => true; f.plugin.openAlexKey = () => 'test-key';
  f.plugin.citationDue = item => !checked.has(item.id);
  f.plugin.citationRecord = item => ({key: f.plugin.identity(item), id: item.id});
  f.plugin.citationTools = {identity: record => record.key, lookupMany: async records => {
    batches.push(records.map(record => record.id));
    if (batches.length === 1) await gate;
    for (const record of records) checked.add(record.id);
  }};
  await w.tick(); assert.equal(batches.length, 1);
  w.visible(100); await w.tick();
  assert.equal(batches.length, 1); assert.equal(f.plugin.windows.get(w.win).citationCheckPending, true);
  const job = f.plugin.citationJob; release(); await job.promise; await w.tick(); await settle();
  assert.deepEqual(batches, [[0,1,2,3,4,5],[100,101,102,103,104,105]]);
  await f.plugin.stop(); f.plugin.cancelScheduledFlush();
});

test('dirty data schedules one save without waiting for a list event and cancels on its owning window', async () => {
  const f = fixture(), w = f.window(); await w.tick(); let writes = 0;
  f.Z.getMainWindow = () => w.win;
  f.plugin.storage.write = async () => {writes++;};
  f.plugin.flush = Runtime.prototype.flush;
  f.plugin.shareFacts = () => {};
  f.plugin.cache.example = 42; f.plugin.dirty = true; f.plugin.dirty = true;
  assert.equal(w.timers.size, 1);
  // Closing the timer's main window must not clear a different window's timer.
  f.Z.getMainWindow = () => ({clearTimeout() {assert.fail('wrong timer owner');}});
  await f.plugin.flush(); assert.equal(w.timers.size, 0); assert.equal(writes, 1);
  assert.equal(f.plugin.dirty, false);
  await f.plugin.stop();
});

test('recycled virtual rows release their detached decoration bookkeeping', async () => {
  const f = fixture(), w = f.window(); await w.tick();
  w.host.replaceChildren(); const state = f.plugin.windows.get(w.win), keep = w.win.document.createElement('span');
  w.host.append(keep);
  for (const key of ['titlePositions','titleWeights','venueColors','highlightRows']) {
    state[key] = new Map([[keep, 'keep']]);
    for (let i = 0; i < 200; i++) state[key].set(w.win.document.createElement('span'), 'discard');
  }
  Runtime.prototype.enhanceTitles.call(f.plugin, w.win, state, []);
  for (const key of ['titlePositions','titleWeights','venueColors','highlightRows']) assert.equal(state[key].size, 1);
  // Real restoration values are not needed by this bookkeeping test.
  for (const key of ['titlePositions','titleWeights','venueColors','highlightRows']) state[key].clear();
  await f.plugin.stop();
});
