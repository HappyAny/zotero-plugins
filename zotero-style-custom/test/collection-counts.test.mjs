import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
const require = createRequire(import.meta.url);
const Counts = require('../src/collection-counts.js');
const paper = (id, extra = {}) => ({id, isRegularItem: () => true, deleted: false, ...extra});
const other = id => paper(id, {isRegularItem: () => false});
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function fixture(rows, {items = [], recursive = false, libraryItems} = {}) {
  const prefs = new Map([['recursiveCollections', recursive]]), observers = new Map(),
    prefObservers = new Map(), timers = new Map(), errors = [], reads = [];
  let next = 0, feature = true;
  const all = new Map(items.map(item => [item.id, item]));
  const Z = {
    Items: {
      async getAll(...args) { reads.push(args); return libraryItems ? libraryItems(...args) : items; },
      async getAsync(ids) { return ids.map(id => all.get(id)); },
    },
    Prefs: {get: key => prefs.get(key),
      registerObserver: (key, callback) => {const id = ++next; prefObservers.set(id, {key, callback}); return id;},
      unregisterObserver: id => prefObservers.delete(id)},
    Notifier: {registerObserver: (observer, types) => {
      const supported = new Set(['item', 'collection', 'collection-item', 'search', 'trash', 'group', 'feed']);
      assert.ok(types.every(type => supported.has(type)), 'use supported Zotero notification types');
      const id = ++next; observers.set(id, observer); return id;},
      unregisterObserver: id => observers.delete(id)},
    logError: error => errors.push(error),
  };
  const runtime = {featureEnabled: () => feature};
  const service = Counts.create({Zotero: Z, runtime});
  function window() {
    const {document} = parseHTML('<html><head></head><body><div id="tree"></div></body></html>');
    const host = document.querySelector('#tree');
    const view = {
      rows: [...rows], getRow(index) { return this.rows[index]; },
      renderItem(index, selection, oldDiv) {
        const div = oldDiv || document.createElement('div');
        div.className = 'row';
        div.innerHTML = '<span class="cell label primary"><span class="cell-icon"></span><span class="cell-text"></span></span>';
        div.querySelector('.cell-text').textContent = this.rows[index].ref.name || 'Research';
        return div;
      },
      tree: {invalidations: 0, invalidate() { this.invalidations++; }, forceUpdate(fn) { fn?.(); }},
      forceUpdate(fn) { fn?.(); }, waitForLoad: async () => {},
    };
    const win = {document, ZoteroPane: {collectionsView: view}, closed: false,
      setTimeout(fn, ms) {const id = ++next; timers.set(id, {fn, ms}); return id;},
      clearTimeout: id => timers.delete(id)};
    const original = view.renderItem;
    const cleanup = service.attach(win);
    function render(index, oldDiv) {const div = view.renderItem(index, {}, oldDiv, []); host.appendChild(div); return div;}
    return {win, view, host, cleanup, original, render};
  }
  const first = window();
  const badge = div => div.querySelector('.style-custom-collection-count')?.textContent;
  function notify(event = 'add', type = 'item') {for (const observer of observers.values()) observer.notify(event, type);}
  function flush() {const jobs = [...timers.values()]; timers.clear(); for (const job of jobs) job.fn();}
  function setPref(key, value) {prefs.set(key, value); for (const o of prefObservers.values()) if (o.key === key) o.callback();}
  return {...first, window, Z, service, runtime, prefs, observers, prefObservers, timers,
    errors, reads, all, badge, notify, flush, setPref, setFeature(value) {feature = value;}};
}

const library = id => ({type: 'library', ref: {libraryID: id}, id: 'L' + id});
const collection = (id, items, descendants = []) => ({type: 'collection', id: 'C' + id,
  ref: {id, libraryID: 1, getChildItems: () => items,
    getDescendents: () => [...items, ...descendants].map(item => ({id: item.id}))}});

test('native library and collection badges count distinct live papers, excluding attachments and notes', async () => {
  const items = [paper(1), paper(2), other(3), paper(4, {deleted: true})];
  const f = fixture([library(1), collection(10, [...items, items[0]]), collection(11, [])], {items});
  await settle();
  const divs = f.view.rows.map((_, i) => f.render(i)); await settle();
  assert.deepEqual(divs.map(f.badge), ['2', '2', '0']);
  assert.deepEqual(f.reads, [[1, true, false]]);
  assert.equal(f.timers.size, 0, 'count rendering starts no periodic timer');
  await f.service.stop();
});

test('recursive collection counts follow the native preference and deduplicate papers', async () => {
  const a = paper(1), b = paper(2);
  const f = fixture([collection(10, [a], [a, b, other(3)])], {items: [a, b, other(3)]});
  await settle(); let div = f.render(0); await settle(); assert.equal(f.badge(div), '1');
  f.setPref('recursiveCollections', true); f.flush();
  div = f.render(0, div); await settle(); assert.equal(f.badge(div), '2');
  await f.service.stop();
});

test('a pending count cannot land on a recycled row or a different library', async () => {
  let resolve;
  const f = fixture([library(1), collection(10, [paper(7)])],
    {libraryItems: () => new Promise(done => {resolve = done;})});
  await settle(); const div = f.render(0); await settle();
  f.render(1, div); await settle(); assert.equal(f.badge(div), '1');
  resolve([paper(1), paper(2)]); await settle();
  assert.equal(f.badge(div), '1');
  await f.service.stop();
});

test('multiple windows share pending counts and cached counts; metadata edits keep membership caches', async () => {
  const items = [paper(1)], f = fixture([library(1)], {items});
  const second = f.window(); await settle();
  const a = f.render(0), b = second.render(0); await settle();
  assert.equal(f.reads.length, 1); assert.equal(f.badge(a), '1'); assert.equal(f.badge(b), '1');
  f.notify('modify'); f.flush(); f.render(0, a); await settle();
  assert.equal(f.reads.length, 1, 'a title or Extra edit cannot change folder membership');
  await f.service.stop();
});

test('membership notifications are coalesced and expired pending results are ignored', async () => {
  let resolve;
  const items = [paper(1)], f = fixture([library(1)],
    {libraryItems: () => new Promise(done => {resolve = done;})});
  await settle(); const div = f.render(0); await settle(); const oldResolve = resolve;
  for (let i = 0; i < 20; i++) f.notify('add', 'collection-item');
  assert.equal(f.timers.size, 1);
  oldResolve([paper(1), paper(2)]); await settle();
  assert.equal(f.badge(div), undefined);
  f.flush(); f.render(0, div); await settle(); resolve(items); await settle();
  assert.equal(f.badge(div), '1');
  assert.equal(f.timers.size, 0);
  f.notify('select'); f.notify('redraw'); assert.equal(f.timers.size, 0);
  await f.service.stop();
});

test('saved and virtual rows use unfiltered native results; trash retains deleted papers', async () => {
  const types = ['search', 'duplicates', 'unfiled', 'recentlyRead', 'retracted', 'publications', 'trash'];
  const rows = types.map((type, id) => ({type, ref: {id, libraryID: 1},
    async getItems(options) {
      assert.deepEqual(options, {unfiltered: true});
      return [paper(1), paper(1), other(2), paper(3, {deleted: true})];
    }}));
  const f = fixture(rows); await settle(); const divs = rows.map((_, i) => f.render(i)); await settle();
  assert.deepEqual(divs.map(f.badge), ['1', '1', '1', '1', '1', '1', '2']);
  await f.service.stop();
});

test('disable and cleanup remove badges, observers and timers and restore the renderer', async () => {
  const f = fixture([library(1)], {items: [paper(1)]});
  await settle(); let div = f.render(0); await settle(); assert.equal(f.badge(div), '1');
  f.setFeature(false); f.service.applyPreferences(); f.flush();
  div = f.render(0, div); await settle(); assert.equal(f.badge(div), undefined);
  f.setFeature(true); f.service.applyPreferences(); f.flush(); f.render(0, div); await settle();
  assert.equal(f.badge(div), '1');
  f.notify(); await f.cleanup();
  assert.equal(f.view.renderItem, f.original); assert.equal(f.badge(div), undefined);
  assert.equal(f.observers.size, 0); assert.equal(f.prefObservers.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.win.document.querySelector('style'), null);
  await f.service.stop(); assert.equal(f.errors.length, 0);
});

test('late results after cleanup cannot add a badge or replace a later plugin wrapper', async () => {
  let resolve;
  const f = fixture([library(1)], {libraryItems: () => new Promise(done => {resolve = done;})});
  await settle(); const div = f.render(0); await settle();
  const ours = f.view.renderItem, later = (...args) => ours(...args); f.view.renderItem = later;
  await f.cleanup(); resolve([paper(1)]); await settle();
  assert.equal(f.view.renderItem, later); assert.equal(f.badge(div), undefined);
});

test('another plugin count and a numeric folder name are handled separately', async () => {
  const f = fixture([collection(10, [paper(1)])]);
  await settle(); const original = f.view.renderItem;
  // A later wrapper draws another plugin's count before the pending result arrives.
  const div = f.render(0); div.querySelector('.cell-text').textContent = '2026';
  const foreign = f.win.document.createElement('span');
  foreign.className = 'zoterostyle-collection-item-count'; foreign.textContent = '8';
  div.querySelector('.primary').appendChild(foreign); await settle();
  assert.equal(f.badge(div), undefined); assert.equal(foreign.textContent, '8');
  const fresh = original.call(f.view, 0, {}); fresh.querySelector('.cell-text').textContent = '2026';
  await settle(); assert.equal(f.badge(fresh), '1');
  await f.service.stop();
});

test('close before readiness cancels bounded retries without touching a missing view', async () => {
  const f = fixture([]); await f.cleanup();
  f.win.ZoteroPane.collectionsView = null;
  const cleanup = f.service.attach(f.win);
  assert.equal(f.timers.size, 1); await cleanup();
  assert.equal(f.timers.size, 0); assert.equal(f.errors.length, 0);
});

test('count failures leave Zotero labels usable and are logged once per cache entry', async () => {
  const f = fixture([library(1)], {libraryItems: async () => {throw new Error('Unavailable library');}});
  await settle(); const div = f.render(0); await settle();
  assert.equal(f.badge(div), undefined); assert.equal(f.errors.length, 1);
  f.render(0, div); await settle(); assert.equal(f.errors.length, 1);
  assert.equal(div.querySelector('.cell-text').textContent, 'Research');
  await f.service.stop();
});
