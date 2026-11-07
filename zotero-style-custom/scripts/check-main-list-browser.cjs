/* Run with Playwright, a headless browser, and an installed Zotero omni.ja.
   Native source remains an input. This script does not copy it into releases. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {parseArgs} = require('node:util');
const {createHash} = require('node:crypto');
const {values} = parseArgs({options: {
  omni: {type: 'string'}, browser: {type: 'string'}, 'playwright-module': {type: 'string'},
  out: {type: 'string'}, 'baseline-ref': {type: 'string', default: '7af0068'}
}});
assert.ok(values.omni && values.browser, 'Use --omni PATH --browser PATH.');
const {chromium} = require(values['playwright-module'] || 'playwright');
const repo = path.resolve(__dirname, '../..');
const output = path.resolve(values.out || path.join(repo, 'build/main-list-proof'));
fs.mkdirSync(output, {recursive: true});
const extract = spawnSync('python', ['-X', 'utf8', '-c', `
import sys,zipfile,json
with zipfile.ZipFile(sys.argv[1]) as z:
 names={'table':'chrome/content/zotero/components/virtualized-table.js',
        'draggable':'chrome/content/zotero/components/draggable.js',
        'utils':'chrome/content/zotero/components/utils.js',
        'css':'chrome/content/zotero-platform/win/zotero.css'}
 print(json.dumps({k:z.read(v).decode() for k,v in names.items()}))
`, path.resolve(values.omni)], {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
assert.equal(extract.status, 0, extract.stderr);
const native = JSON.parse(extract.stdout);
const between = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Native source changed: ' + start);
  return source.slice(a, b);
};
// Execute the installed version's handlers and Columns.onResize unchanged.
const nativeCode = `
const Zotero = {rtl:false, debug(){}};
${native.table.match(/const RESIZER_WIDTH = [^;]+;/)[0]}
${native.table.match(/const COLUMN_MIN_WIDTH = [^;]+;/)[0]}
${native.table.match(/const COLUMN_PADDING = [^;]+;/)[0]}
window.NativeTable = class {
${between(native.table, '  _handleResizerDragStart =', '  _handleResizerDrag =')}
${between(native.table, '  _handleResizerDrag =', '  _getColumns()')}
${between(native.table, '  _getResizeColumns(index)', '  _handleMouseOver =')}
${between(native.table, '  _handleResizerDragStop =', '  _handleColumnDragStart =')}
};
window.NativeColumns = class {
${between(native.table, '  onResize = (columnWidths', '  setOrder =')}
};
${between(native.utils, 'function createDragHandler(', 'var _htmlID')}
class PureComponent { constructor(props) {this.props=props;} }
const func={}, string={}, number={}, node={};
${between(native.draggable, 'const DRAG =', 'module.exports =')}
window.NativeDraggable = Draggable;
`;
const baseline = spawnSync('git', ['show', values['baseline-ref'] + ':zotero-style-custom/src/runtime.js'],
  {cwd: repo, encoding: 'utf8', maxBuffer: 3 * 1024 * 1024});
assert.equal(baseline.status, 0, baseline.stderr);
const current = fs.readFileSync(path.join(repo, 'zotero-style-custom/src/runtime.js'), 'utf8');
const report = {nativeSourceSHA256: Object.fromEntries(Object.entries(native).map(([k, s]) =>
  [k, createHash('sha256').update(s).digest('hex')])), baselineRef: values['baseline-ref'], cases: []};
const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1, `${label}: ${actual} vs ${expected}`);

(async () => {
  const browser = await chromium.launch({executablePath: path.resolve(values.browser), headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1300, height: 650}});
    const setup = async ({source = current, viewport = 800, widths = [420, 180, 120, 66, 80, 28], rtl = false} = {}) => {
      await page.goto('about:blank');
      await page.setContent('<html><head></head><body><h2>Main library list</h2><div id="zotero-items-tree" class="virtualized-table"><div class="virtualized-table-header"></div><div class="virtualized-table-body"><div class="windowed-list"></div></div></div><div id="other"><div class="virtualized-table-header"><div class="resizer creator">Other table</div></div></div></body></html>');
      await page.addStyleTag({content: native.css});
      await page.addStyleTag({content: `body{margin:32px;font:14px system-ui;background:white;color:#202020}#zotero-items-tree{width:${viewport}px;height:390px;border:1px solid #ccc} .virtualized-table-header{height:32px}.row{height:36px}#other{margin-top:32px}`});
      await page.addScriptTag({content: nativeCode});
      for (const name of ['i18n', 'strings', 'item-kinds']) {
        await page.addScriptTag({content: fs.readFileSync(path.join(repo, 'zotero-style-custom/src', name + '.js'), 'utf8')});
      }
      await page.addScriptTag({content: source});
      await page.evaluate(({widths, rtl}) => {
        document.documentElement.dir = 'ltr'; Zotero.rtl = rtl;
        const root = document.getElementById('zotero-items-tree'), header = root.querySelector('.virtualized-table-header');
        root.dir = rtl ? 'rtl' : 'ltr';
        const list = root.querySelector('.windowed-list');
        const defs = [['title', 'Title'], ['creator', 'Creator'], ['date', 'Date'], ['citations', 'Citations'], ['journal', 'Journal'], ['more', '⋯']];
        const cols = defs.map(([dataKey, label], i) => ({dataKey, label, width: widths[i], ordinal: i,
          minWidth: i === 3 ? 50 : 20, ...(i === 5 ? {fixedWidth: true, iconLabel: '⋯'} : {})}));
        root.style.setProperty('--first-column-extra-width', '24px');
        const ruleNode = document.createElement('style'); document.head.append(ruleNode);
        const styleMap = {};
        for (const [i, c] of cols.entries()) {
          styleMap[c.dataKey] = i; ruleNode.sheet.insertRule(`#zotero-items-tree .cell.${c.dataKey}{flex-basis:100px}`, i);
          const cell = document.createElement('div'); cell.className = `cell ${c.dataKey}${c.iconLabel ? ' cell-icon' : ''}`;
          if (i) { const edge = document.createElement('div'); edge.className = 'resizer draggable ' + c.dataKey; cell.append(edge); }
          const label = document.createElement('span'); label.className = 'label'; label.textContent = c.label; cell.append(label); header.append(cell);
        }
        for (let i = 0; i < 6; i++) {
          const row = document.createElement('div'); row.className = 'row'; row.id = 'item-row-' + i;
          for (const c of cols) {
            const cell = document.createElement('span'); cell.className = 'cell ' + c.dataKey;
            const label = document.createElement('span'); label.className = 'cell-text';
            label.textContent = {title: ['Electro-optic frequency combs', 'Spectral shaping of electro-optical frequency combs using machine learning', 'US20240352440A1.pdf'][i % 3], creator: 'Pinto', date: '2026-01-01', citations: '123', journal: 'Optics Letters', more: '⋯'}[c.dataKey];
            cell.append(label); row.append(cell);
          }
          list.append(row);
        }
        let prefs = {}; const tree = new NativeTable();
        tree.props = {id: root.id}; tree.state = {}; tree.firstColumnExtraWidth = 24;
        tree.setState = next => Object.assign(tree.state, next); tree._getVisibleColumns = () => cols;
        tree._debouncedRerender = () => {};
        const manager = new NativeColumns(); tree._columns = manager;
        manager._virtualizedTable = tree; manager._columns = cols; manager._columnStyleMap = styleMap;
        manager._stylesheet = ruleNode; manager.getAsArray = () => cols;
        manager._getPrefs = () => structuredClone(prefs); manager._storePrefs = p => {prefs = structuredClone(p);};
        manager._getColumnPrefsToPersist = c => ({width: c.width});
        manager.onResize(Object.fromEntries(cols.map(c => [c.dataKey, c.width])));
        window.ZoteroPane = {itemsView: {tree}};
        for (const [i, c] of cols.entries()) {
          const edge = header.querySelector('.resizer.' + c.dataKey); if (!edge) continue;
          const draggable = new NativeDraggable({delay: 0, onDragStart: e => tree._handleResizerDragStart(i, e),
            onDrag: tree._handleResizerDrag, onDragStop: tree._handleResizerDragStop});
          edge.addEventListener('mousedown', e => draggable.handleMouseDown(e));
        }
        const plugin = window.plugin = Object.create(CustomStyleRuntime.prototype);
        plugin.Z = {rtl, logError: e => {throw e;}, Prefs: {set(){}}};
        plugin.i18n = CustomStyleI18N; plugin.i18n.load(CustomStyleStrings.en); plugin.i18n.use('en-US');
        plugin.itemKinds = CustomStyleItemKinds; plugin.palette = () => ({amber: '#885500', purple: '#553388'});
        const state = window.state = {listeners: [], titleNodes: new Set()};
        plugin.attachColumnFit(window, state); plugin.rollTable(window, state);
        for (const [i, row] of [...list.children].entries()) {
          const title = row.querySelector('.title').textContent;
          plugin.paintKind(row, {itemType: i % 3 === 1 ? 'thesis' : i % 3 === 2 ? 'attachment' : 'journalArticle',
            attachmentFilename: title, isAttachment: () => i % 3 === 2, getField: () => title}, state, window);
        }
        window.measure = () => {
          const current = document.getElementById('zotero-items-tree'), h = current.querySelector('.virtualized-table-header'), l = current.querySelector('.windowed-list');
          return Object.fromEntries(cols.map(c => [c.dataKey, {
            width: h.querySelector('.cell.' + c.dataKey).getBoundingClientRect().width,
            headerX: h.querySelector('.cell.' + c.dataKey).getBoundingClientRect().x,
            bodyX: l.querySelector('.cell.' + c.dataKey).getBoundingClientRect().x,
            bodyWidth: l.querySelector('.cell.' + c.dataKey).getBoundingClientRect().width
          }]));
        };
        window.rebuild = () => {
          for (const c of cols) if (!c.fixedWidth && prefs[c.dataKey]) c.width = prefs[c.dataKey].width;
          manager.onResize(Object.fromEntries(cols.map(c => [c.dataKey, c.width]))); plugin.rollTable(window, state);
        };
        window.saved = () => prefs;
      }, {widths, rtl});
    };
    const measure = () => page.evaluate(() => measure());
    const drag = async (edge, delta, finish = 'mouseup') => {
      const box = await page.locator('#zotero-items-tree .resizer.' + edge).boundingBox(); assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, {steps: 12});
      if (finish === 'Escape') await page.keyboard.press('Escape');
      if (finish === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.mouse.up();
    };
    const checkAligned = async () => {
      for (const [key, cell] of Object.entries(await measure())) {
        closeTo(cell.headerX, cell.bodyX, key + ' x'); closeTo(cell.width, cell.bodyWidth, key + ' width');
      }
    };
    await setup({source: baseline.stdout});
    const oldBefore = await measure(); await drag('citations', 140); const oldAfter = await measure();
    const oldBadges = await page.locator('.style-custom-kind').allTextContents();
    assert.ok(oldBadges.includes('학위논문'), 'The baseline must reproduce the Korean badge.');
    assert.ok(oldAfter.date.width - oldBefore.date.width < 20, 'The baseline must reproduce the constrained drag.');
    report.baseline = {before: oldBefore.date.width, after: oldAfter.date.width, mouseDelta: 140, badges: oldBadges};

    await setup(); const before = await measure(); await drag('citations', 140); const after = await measure();
    closeTo(after.date.width, before.date.width + 140, 'independent Date drag');
    for (const key of Object.keys(before).filter(k => k !== 'date')) closeTo(after[key].width, before[key].width, 'unchanged ' + key);
    await checkAligned();
    for (let i = 0; i < 5; i++) await page.evaluate(() => rebuild());
    const restored = await measure();
    for (const key of Object.keys(after)) closeTo(restored[key].width, after[key].width, 'restored ' + key);
    const badges = await page.locator('.style-custom-kind').allTextContents();
    assert.ok(badges.includes('Thesis') && badges.includes('Patent')); assert.ok(badges.every(s => !/[\uac00-\ud7af]/.test(s)));
    const titles = await page.locator('.style-custom-kind').evaluateAll(nodes => nodes.map(n => n.title));
    assert.ok(titles.every(s => !/[\uac00-\ud7af]/.test(s)), 'English patent office tooltips');
    report.cases.push({case: 'narrow neighbour, English badges, five list rebuilds', before, after, restored, badges, titles, saved: await page.evaluate(() => saved())});
    await page.screenshot({path: path.join(output, 'main-list-english.png')});
    await page.evaluate(() => {document.querySelector('.virtualized-table-body').scrollLeft = 150;});
    await page.waitForTimeout(80); await checkAligned();
    await page.screenshot({path: path.join(output, 'main-list-scrolled.png')});
    await drag('citations', -90); await checkAligned();
    const scrolled = await measure(); closeTo(scrolled.date.width, after.date.width - 90, 'drag after horizontal scroll');
    for (const finish of ['Escape', 'blur']) {
      const initial = await measure(); await drag('citations', 80, finish); const cancelled = await measure();
      for (const key of Object.keys(initial)) closeTo(cancelled[key].width, initial[key].width, 'cancel ' + finish + ' ' + key);
    }
    report.cases.push({case: 'scroll alignment, drag after scroll, Escape, window blur', pass: true});
    await page.evaluate(() => {const root = document.getElementById('zotero-items-tree'); root.replaceWith(root.cloneNode(true));});
    await page.waitForTimeout(80);
    await page.evaluate(() => {document.querySelector('#zotero-items-tree .virtualized-table-body').scrollLeft = 200;});
    await page.waitForTimeout(80); await checkAligned();
    const outside = await page.evaluate(() => {
      const other = document.querySelector('#other .resizer');
      return ['mousedown', 'mousemove', 'mouseup', 'dblclick'].map(type => {
        const e = new MouseEvent(type, {bubbles: true, cancelable: true, button: 0, clientX: 100}); other.dispatchEvent(e); return e.defaultPrevented;
      });
    });
    assert.deepEqual(outside, [false, false, false, false]);
    await page.evaluate(() => {state.columnDragCleanup(); state.rollCleanup();});
    assert.equal(await page.locator('.style-custom-column-widths').count(), 0);
    assert.equal(await page.evaluate(() => state.columnLayoutStyle.isConnected), false);
    report.cases.push({case: 'table replacement, other tables, layout cleanup', pass: true});

    await setup({viewport: 1120, widths: [300, 120, 90, 66, 100, 28]});
    const spare = await measure(); await drag('creator', 100); const grown = await measure();
    closeTo(grown.title.width, spare.title.width + 100, 'drag with spare room');
    for (const key of Object.keys(spare).filter(k => k !== 'title')) closeTo(grown[key].width, spare[key].width, 'spare-room neighbour ' + key);
    await drag('creator', -180); const shrunk = await measure(); closeTo(shrunk.title.width, grown.title.width - 180, 'shrink with spare room');
    await drag('more', 90); const last = await measure(); closeTo(last.journal.width, shrunk.journal.width + 90, 'last flexible column before fixed icon');
    await checkAligned();
    await page.locator('#zotero-items-tree .resizer.creator').dblclick();
    assert.ok(await page.evaluate(() => state.columnFit.fitted > 0), 'A real double-click still fits the column.');
    await drag('creator', -1500); closeTo((await measure()).title.width, 36, 'minimum width');
    await checkAligned();
    report.cases.push({case: 'spare room, shrink, last flexible column, double-click fit', pass: true});

    await setup({rtl: true, viewport: 1120, widths: [300, 120, 90, 66, 100, 28]});
    const rtlBefore = await measure(); await drag('creator', -80); const rtlAfter = await measure();
    closeTo(rtlAfter.title.width, rtlBefore.title.width + 80, 'RTL drag'); await checkAligned();
    report.cases.push({case: 'right-to-left pointer direction and alignment', pass: true});
    report.engine = await page.evaluate(() => navigator.userAgent);
    report.liveZoteroInteraction = false;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({baseline: report.baseline, cases: report.cases.map(c => c.case), receipt: path.join(output, 'result.json')}) + '\n');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
