import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
const require = createRequire(import.meta.url);
const Runtime = require('../src/runtime.js');
const settle = async () => {for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));};
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const file = (id, path = `D:\\Papers\\${id}.pdf`) => ({id, libraryID: 1, parentID: 1,
  isRegularItem: () => false, isFileAttachment: () => true, getFilePathAsync: async () => path});
const paper = (id, attachment) => ({id, libraryID: 1, key: 'K' + id, isRegularItem: () => true,
  isFileAttachment: () => false, numAttachments: () => attachment ? 1 : 0,
  getBestAttachment: async () => attachment});

function fixture(initial = []) {
  const {document, window} = parseHTML('<html><head></head><body><menupopup id="zotero-itemmenu"><menuitem id="native-open"></menuitem><menuitem id="native-show-file"></menuitem></menupopup></body></html>');
  document.createXULElement = tag => document.createElement(tag);
  let selection = initial;
  const launched = [], errors = [], messages = [], prefs = new Map([['fileHandler.pdf', 'C:\\CustomReader\\reader.exe']]);
  const Z = {Prefs: {get: key => prefs.get(key), set() {assert.fail('opening must not change reader preferences');}},
    Libraries: {userLibraryID: 1, get: id => ({libraryID: id, editable: id !== 2})},
    launchFile: async path => launched.push(path), logError: error => errors.push(error),
    Reader: {open() {assert.fail('system-default action must not open the Zotero reader');}},
    FileHandlers: {open() {assert.fail('system-default action must bypass configured reader handlers');}}};
  const runtime = new Runtime({Zotero: Z, model: {}, storage: {}, marquee: {}, reading: {}});
  runtime.active = true; runtime.palette = () => ({text: '#222'});
  runtime.say = async (_win, message, options) => messages.push({message, ...options});
  const win = {document, ZoteroPane: {getSelectedItems: () => selection}, closed: false};
  const state = {nodes: [], menuNodes: [], listeners: []}; runtime.windows.set(win, state);
  const popup = document.getElementById('zotero-itemmenu');
  const menu = () => document.getElementById('style-custom-open-system-default');
  const show = () => popup.dispatchEvent(new window.Event('popupshowing', {bubbles: true}));
  const command = () => menu().dispatchEvent(new window.Event('command'));
  return {Z, runtime, win, document, window, state, popup, menu, show, command, launched, errors, messages, prefs,
    select: value => {selection = value;}};
}

test('system default opens a parent paper main attachment without changing reader preferences or item data', async () => {
  const attachment = file(2), item = paper(1, attachment), f = fixture([item]);
  const before = JSON.stringify(item);
  assert.deepEqual(await f.runtime.openWithSystemDefault(f.win), {opened: 1, missing: 0, failed: 0, skipped: 0});
  assert.deepEqual(f.launched, ['D:\\Papers\\2.pdf']);
  assert.equal(f.prefs.get('fileHandler.pdf'), 'C:\\CustomReader\\reader.exe');
  assert.equal(JSON.stringify(item), before);
});

test('a selected attachment opens that file directly, including standalone and read-only group attachments', async () => {
  const attachment = {...file(9), parentID: null, libraryID: 2, isEditable: () => false};
  const f = fixture([attachment]);
  f.Z.Items = {get() {assert.fail('the action must not substitute the parent or another attachment');}};
  assert.equal(f.runtime.canOpenWithSystemDefault(f.win), true);
  await f.runtime.openWithSystemDefault(f.win); assert.deepEqual(f.launched, ['D:\\Papers\\9.pdf']);
});

test('mixed multi-selection deduplicates parent, child and shared paths and skips notes, URLs and deleted files', async () => {
  const attachment = file(2), other = file(3), note = {isRegularItem: () => false}, url = {isFileAttachment: () => false};
  const f = fixture([paper(1, attachment), attachment, file(4, 'D:\\Papers\\2.pdf'), other, note, url, {...file(5), deleted: true}]);
  const result = await f.runtime.openWithSystemDefault(f.win);
  assert.deepEqual(f.launched, ['D:\\Papers\\2.pdf', 'D:\\Papers\\3.pdf']);
  assert.equal(result.opened, 2); assert.equal(result.skipped, 3); assert.equal(result.failed, 0);
});

test('paths with spaces, Unicode and shell metacharacters are passed literally to the native launcher', async () => {
  const path = 'D:\\论文资料\\paper $(ignored) & [draft] `notes`.epub';
  const f = fixture([file(2, path)]); await f.runtime.openWithSystemDefault(f.win);
  assert.deepEqual(f.launched, [path]);
});

test('the command captures its selection before an asynchronous main-attachment lookup', async () => {
  const lookup = deferred(), first = {...paper(1, file(2)), getBestAttachment: () => lookup.promise};
  const f = fixture([first]), work = f.runtime.openWithSystemDefault(f.win);
  f.select([file(99)]); lookup.resolve(file(2)); await work;
  assert.deepEqual(f.launched, ['D:\\Papers\\2.pdf']);
});

test('missing local files and launch failures are counted while other selected files still open', async () => {
  const f = fixture([file(2, false), file(3), file(4)]);
  f.Z.launchFile = async path => {if (path.endsWith('3.pdf')) throw Error('No associated application'); f.launched.push(path);};
  assert.deepEqual(await f.runtime.openWithSystemDefault(f.win), {opened: 1, missing: 1, failed: 1, skipped: 0});
  assert.deepEqual(f.launched, ['D:\\Papers\\4.pdf']); assert.equal(f.errors.length, 1);
});

test('Style Custom owns a direct context-menu action that follows the current raw selection and stays idle until invoked', async () => {
  const f = fixture(); f.runtime.buildMenus(f.win, f.state);
  assert.equal(f.menu().getAttribute('label'), 'Open with System Default'); assert.equal(f.menu().parentNode, f.popup);
  assert.equal(f.popup.children[0].id, 'native-open'); assert.equal(f.popup.children[1].id, 'native-show-file');
  assert.equal(f.menu().disabled, true);
  let lookups = 0; const attachment = {...file(2), getFilePathAsync: async () => {lookups++; return 'D:\\Papers\\2.pdf';}};
  f.select([attachment]); f.show(); assert.equal(f.menu().disabled, false);
  assert.equal(lookups, 0); assert.equal(f.launched.length, 0);
  f.command(); f.command(); await settle();
  assert.deepEqual(f.launched, ['D:\\Papers\\2.pdf']); assert.equal(lookups, 1); assert.equal(f.menu().disabled, false);
  f.select([paper(3, null)]); f.show(); assert.equal(f.menu().disabled, true);
  await f.runtime.removeWindow(f.win); assert.equal(f.menu(), null);
});

test('menu rebuilds and teardown remove their old entries and popup listeners', async () => {
  const f = fixture([file(2)]); f.runtime.buildMenus(f.win, f.state);
  f.runtime.rebuildMenus(); f.runtime.rebuildMenus();
  assert.equal(f.document.querySelectorAll('#style-custom-open-system-default').length, 1);
  assert.equal(f.document.querySelectorAll('#style-custom-itemmenu').length, 1);
  let checks = 0; const canOpen = f.runtime.canOpenWithSystemDefault.bind(f.runtime);
  f.runtime.canOpenWithSystemDefault = win => {checks++; return canOpen(win);};
  f.show(); assert.equal(checks, 1);
  await f.runtime.removeWindow(f.win); f.show(); assert.equal(checks, 1); assert.equal(f.menu(), null);
});

test('teardown and shutdown prevent a late file lookup from opening an external application', async () => {
  for (const stop of ['teardown', 'shutdown', 'closed']) {
    const path = deferred(), f = fixture([{...file(2), getFilePathAsync: () => path.promise}]);
    f.runtime.attachSystemDefaultMenu(f.win, f.state); f.command(); await settle();
    if (stop === 'teardown') await f.runtime.removeWindow(f.win);
    else if (stop === 'shutdown') f.runtime.stopping = true;
    else f.win.closed = true;
    path.resolve('D:\\Papers\\2.pdf'); await settle();
    assert.deepEqual(f.launched, []); assert.deepEqual(f.messages, []);
  }
});

test('a missing local attachment reports how to make the file available', async () => {
  const f = fixture([file(2, false)]); f.runtime.attachSystemDefaultMenu(f.win, f.state);
  f.command(); await settle();
  assert.equal(f.launched.length, 0); assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].message, /Download the attachment in Zotero first/);
  assert.equal(f.messages[0].error, true);
});

test('system default sits immediately below both native Open PDF actions and survives native menu rebuilds', async () => {
  const f = fixture([file(2)]); f.runtime.buildMenus(f.win, f.state);
  const original = [f.popup.children[0], f.popup.children[1]], own = f.menu();
  function nativeActions(count = 2) {
    const first = f.popup.firstChild;
    for (const [id, label] of [['open-tab', '在新标签页打开 PDF'], ['open-window', '在新窗口打开 PDF']].slice(0, count)) {
      const node = f.document.createElement('menuitem'); node.id = id;
      node.setAttribute('zotero-locate', 'true'); node.setAttribute('data-l10n-id', 'item-menu-viewAttachment');
      node.setAttribute('label', label); f.popup.insertBefore(node, first);
    }
    for (const id of ['view-online', 'show-file']) {
      const node = f.document.createElement('menuitem'); node.id = id; node.setAttribute('zotero-locate', 'true'); f.popup.insertBefore(node, first);
    }
  }
  for (let i = 0; i < 5; i++) {
    nativeActions(); f.show();
    assert.deepEqual([...f.popup.children].slice(0, 5).map(node => node.id), ['open-tab','open-window','style-custom-open-system-default','view-online','show-file']);
    assert.equal(f.menu(), own);
    // The installed Zotero buildItemContextMenu removes this exact prefix
    // before addressing its static menu rows by childNodes[index].
    while (f.popup.firstChild?.getAttribute('zotero-locate')) f.popup.removeChild(f.popup.firstChild);
    assert.equal(f.popup.children[0], original[0]); assert.equal(f.popup.children[1], original[1]);
  }
  nativeActions(1); f.show(); assert.equal(f.popup.children[1], own);
  f.command(); await settle(); assert.deepEqual(f.launched, ['D:\\Papers\\2.pdf']);
  await f.runtime.removeWindow(f.win);
});

test('when native PDF actions are absent the system-default action is reinserted without changing native row indexes', async () => {
  const f = fixture([file(2)]); f.runtime.buildMenus(f.win, f.state); const own = f.menu();
  own.remove(); f.show();
  assert.equal(f.menu(), own); assert.equal(f.popup.children[0].id, 'native-open'); assert.equal(f.popup.children[1].id, 'native-show-file');
  assert.equal(f.popup.lastChild, own);
  await f.runtime.removeWindow(f.win);
});
