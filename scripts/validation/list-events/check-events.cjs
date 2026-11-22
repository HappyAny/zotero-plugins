const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../..'), root = path.join(repo, 'zotero-style-custom'), nativeDir = path.join(repo, 'build/native-zotero'), out = path.join(repo, 'build/validation/list-events');
fs.mkdirSync(out, {recursive: true});
const acorn = require('acorn');
const {chromium} = require('playwright');
const read = file => fs.readFileSync(file, 'utf8'), sha = text => crypto.createHash('sha256').update(text).digest('hex');
function methods(source, names) {
  const ast = acorn.parse(source, {ecmaVersion: 'latest'}), found = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MethodDefinition' && names.includes(node.key.name) && !found.has(node.key.name)) found.set(node.key.name, source.slice(node.start, node.end));
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
  visit(ast); for (const name of names) assert.ok(found.has(name), 'Missing method ' + name);
  return names.map(name => found.get(name)).join('\n');
}
const current = read(path.join(root, 'src/runtime.js')), nativeTree = read(path.join(nativeDir, 'itemTree.js'));
const nativeMethods = methods(nativeTree, ['refreshAndMaintainSelection', '_restoreSelection', 'invalidateRowCache']);
const invalidate = methods(read(path.join(nativeDir, 'virtualized-table.js')), ['invalidate']);
const paintMethods = methods(current, ['enhanceTitles', 'paintHighlights', 'paintTitleMarkup']);
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME || undefined, headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1000, height: 600}}), errors = [], externalRequests = [], results = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/*', route => {externalRequests.push(route.request().url()); return route.abort();});
    for (const [name, source] of [['old-jump', read(path.join(__dirname, 'baseline-runtime-0.59.64.js'))],
      ['polling', read(path.join(__dirname, 'baseline-runtime-0.59.65.js'))], ['events', current]]) {
      await page.setContent('<html><head><style>#zotero-items-tree{width:760px;height:330px;overflow:auto;overflow-anchor:none}.row{box-sizing:border-box;width:1150px;height:30px;display:flex;gap:20px;padding:5px 12px}.title{width:650px;display:flex}.citations{width:100px}.spacer{width:1150px}</style></head><body><input id="search" value="Preserve this draft"><div id="zotero-items-tree"></div></body></html>');
      const names = ['addWindow', 'refreshWindows'];
      if (name === 'events') names.push('attachItemList', 'requestItemList', 'notifyStatus', 'subscribeLibraryContext');
      results.push(await page.evaluate(async ({name, runtime, paintMethods, nativeMethods, invalidate}) => {
        const checks = [], check = (value, description) => {checks.push({name: description, passed: !!value}); if (!value) throw Error(description);};
        const NativeView = new Function('Zotero', 'return class {' + nativeMethods + '}')({logError: e => {throw e;}});
        const NativePaint = new Function('return class {' + invalidate + '}')();
        const Runtime = new Function('return class {' + runtime + '\n' + paintMethods + '}')();
        const host = document.querySelector('#zotero-items-tree'), items = Array.from({length: 1000}, (_, id) => ({id, key: 'K' + id,
          treeViewID: 'I' + id, libraryID: 1, citations: 1, getField: field => field === 'title' ? 'Paper ' + id : '', isRegularItem: () => true}));
        const binding = () => {const listeners = new Set(); return {listeners, addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit() {for (const fn of listeners) fn();}};};
        const view = new NativeView(), context = binding(); let first = 0, fullRefreshes = 0, repaints = 0, paints = 0;
        Object.assign(view, {_rowCache: {}, _rowMap: Object.fromEntries(items.map((item, i) => [item.treeViewID, i])), collectionTreeRow: {id: 'C1'}, _treebox: {},
          onSelect: binding(), rowProvider: {onUpdate: binding()}, getRow: index => ({ref: items[index]}), getSelectedObjects: () => [...view.selection.selected].map(i => items[i]),
          refresh: async () => {fullRefreshes++; view._rowCache = {};}, clearItemsPaneMessage() {}, forceUpdate: fn => fn()});
        view.selection = {focused: 2, selected: new Set([2]), selectEventsSuppressed: false, clearSelection() {this.selected.clear();},
          select(i) {this.focused = i; this.selected.add(i);}, toggleSelect(i) {this.selected.has(i) ? this.selected.delete(i) : this.selected.add(i);}};
        view.ensureRowsAreVisible = indices => {for (const i of indices) {const top = i * 30, bottom = top + 30;
          if (top < host.scrollTop) host.scrollTop = top; else if (bottom > host.scrollTop + host.clientHeight) host.scrollTop = bottom - host.clientHeight;}};
        function draw() {
          const before = document.createElement('div'), after = document.createElement('div');
          before.className = after.className = 'spacer'; before.style.height = first * 30 + 'px'; after.style.height = (1000 - first - 12) * 30 + 'px';
          const nodes = [before];
          for (let i = first; i < first + 12; i++) {const row = document.createElement('div'), value = view._rowCache[i] ?? (view._rowCache[i] = items[i].citations);
            row.className = 'row'; row.id = 'item-tree-main-row-' + i;
            row.innerHTML = '<span class="cell title"><span class="cell-text">Paper ' + i + '</span></span><span class="cell citations">' + value + '</span>'; nodes.push(row);}
          nodes.push(after); host.replaceChildren(...nodes);
        }
        const tree = new NativePaint(); tree._jsWindow = {invalidate() {repaints++; draw();}}; tree._updateWidth = tree._refreshStickySectionHeader = () => {}; view.tree = tree; draw();
        const timers = new Map(); let now = 0, serial = 0, intervals = 0;
        const win = {document, closed: false, MutationObserver, ZoteroPane: {itemsView: view, collectionsView: {onSelect: context}}, addEventListener() {}, removeEventListener() {},
          setTimeout(fn, ms) {const id = ++serial; timers.set(id, {fn, at: now + ms}); return id;}, clearTimeout: id => timers.delete(id),
          setInterval(fn, ms) {intervals++; const id = ++serial; timers.set(id, {fn, at: now + ms, interval: ms}); return id;}, clearInterval: id => timers.delete(id)};
        const turn = () => new Promise(resolve => setTimeout(resolve, 0));
        async function advance(ms) {const end = now + ms; await turn(); let safety = 0;
          while (true) {const due = [...timers].filter(([, task]) => task.at <= end).sort((a,b) => a[1].at - b[1].at)[0]; if (!due) break;
            if (++safety > 1000) throw Error('Timer feedback loop'); const [id, task] = due; now = task.at; timers.delete(id);
            if (task.interval) timers.set(id, {...task, at: now + task.interval}); await task.fn(); await turn();}
          now = end; await turn();
        }
        const plugin = new Runtime(); Object.assign(plugin, {active: true, windows: new Map(), Library: {create: () => ({})}, Workbench: {attach: () => ({refreshReading() {}})},
          readerTools: {attach: () => () => {}, tabs: () => []}, collectionCounts: {attach: () => () => {}},
          isRegular: item => !!item, identity: item => item.libraryID + ':' + item.key,
          state: item => ({citations: item.citations, rating: 4, status: 'unread', seconds: 0, lastRead: ''}),
          featureEnabled: id => id === 'titleColumn', pref: (key, fallback) => key === 'titleTags' ? true : fallback, getSetting: () => 3,
          displayTags: () => [{tag: 'topic', color: null}], highlightOf: () => null, flush: async () => {}, bumpState() {}, Z: {logError: e => {throw e;}}});
        for (const method of ['attachMotion','attachColumnFit','attachCells','watchItemPane','buildMenus','paintKind','paintVenue']) plugin[method] = () => {};
        const enhance = plugin.enhanceTitles; plugin.enhanceTitles = (...args) => {paints++; return enhance.apply(plugin, args);};
        plugin.addWindow(win); await advance(100);
        const initialPaints = paints; await advance(60000); const idlePaints = paints - initialPaints;
        if (name === 'events') {check(intervals === 0, 'no recurring item-list timer'); check(idlePaints === 0, 'one idle minute performs zero row scans'); check(timers.size === 0, 'actual title decorations do not feed the observer');}
        else check(idlePaints === 12, 'negative control scans rows twelve times per idle minute');
        function move(start) {first = start; draw(); host.scrollTop = start * 30 + 17; host.scrollLeft = 230;}
        move(160); document.querySelector('#search').focus({preventScroll: true}); const before = {top: host.scrollTop, left: host.scrollLeft};
        for (let i = 0; i < 50; i++) host.dispatchEvent(new Event('scroll'));
        const beforeBurst = paints; await advance(5100); const after = {top: host.scrollTop, left: host.scrollLeft};
        if (name === 'old-jump') check(after.top !== before.top, 'negative control reproduces snap to selected paper');
        else check(after.top === before.top && after.left === before.left, 'browsing preserves both scroll axes');
        if (name === 'events') {check(paints === beforeBurst + 1, 'fifty scroll events and native row mutations coalesce once'); check(host.querySelector('.style-custom-title-tags')?.textContent.includes('topic'), 'newly visible titles are actually decorated');}
        move(240); items[240].citations = 42; const backgroundBefore = host.scrollTop; await plugin.refreshWindows(); await advance(100);
        const afterBackground = {top: host.scrollTop, value: host.querySelector('.citations').textContent};
        if (name === 'events') {
          check(afterBackground.top === backgroundBefore && afterBackground.value === '42', 'actual native invalidation updates cached metrics without scrolling');
          check(fullRefreshes === 0, 'background work never restores the selection');
          check(document.activeElement === document.querySelector('#search'), 'the input retains focus and its draft');
          check(view.selection.focused === 2 && JSON.stringify([...view.selection.selected]) === '[2]', 'off-screen selection stays unchanged');
          let contexts = 0; const unsubscribe = plugin.subscribeLibraryContext(win, () => contexts++);
          context.emit(); context.emit(); await advance(100); check(contexts === 2, 'native collection selection reaches subscribers'); unsubscribe();
          const oldTitle = host.querySelector('.cell-text'); oldTitle.textContent = 'Updated native title'; await advance(100);
          check(host.querySelector('.cell-text').textContent === 'Updated native title', 'native title changes are observed without rewriting title data');
          await view._restoreSelection([items[700]]); check(view.selection.focused === 700 && host.scrollTop !== backgroundBefore, 'explicit native navigation still works');
          const state = plugin.windows.get(win); state.listCleanup(); plugin.windows.delete(win);
          check(context.listeners.size === 0 && view.onSelect.listeners.size === 0 && timers.size === 0, 'teardown removes queued paints and native listeners');
        }
        return {name, checks, initialPaints, idlePaints, intervals, before, after, afterBackground, fullRefreshes};
      }, {name, runtime: methods(source, names), paintMethods, nativeMethods, invalidate}));
    }
    assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
    const report = {state: 'complete', environment: 'Chromium with actual installed Zotero 10 refresh, selection and cache methods; controlled timer clock and lightweight row model',
      runtimeSHA256: sha(current), nativeSourceSHA256: sha(nativeTree), results, errors, externalRequests};
    fs.writeFileSync(path.join(out, 'browser-proof.json'), JSON.stringify(report, null, 2) + '\n');
    await page.screenshot({path: path.join(__dirname, 'event-driven-list.png')});
    console.log(JSON.stringify({state: report.state, results: results.map(r => ({name: r.name, checks: r.checks.length, idlePaints: r.idlePaints, before: r.before.top, after: r.after.top})), errors}));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
