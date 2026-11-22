var nativeReport = {state: 'running', checks: []};
var nativeTimer, nativeFinished = false;
const reportPath = __REPORT_PATH__, dataPath = __DATA_PATH__;
function install() {}
function uninstall() {}
function shutdown() {}
function startup({rootURI}) {
  Services.startup.enterLastWindowClosingSurvivalArea();
  nativeTimer = Components.classes['@mozilla.org/timer;1'].createInstance(Components.interfaces.nsITimer);
  nativeTimer.initWithCallback({notify() {finish({...nativeReport, state: 'failed', error: 'Native test exceeded 45 seconds'});}}, 45000, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  run(rootURI).catch(error => finish({...nativeReport, state: 'failed', error: String(error), stack: error.stack}));
}
async function finish(report) {
  if (nativeFinished) return; nativeFinished = true; nativeTimer.cancel();
  try {await IOUtils.writeUTF8(reportPath, JSON.stringify(report, null, 2));}
  finally {Services.startup.exitLastWindowClosingSurvivalArea(); Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);}
}
async function run(rootURI) {
  const report = nativeReport;
  report.runtimeSHA256 = __RUNTIME_SHA__;
  report.externalApplicationLaunchIntercepted = true;
  const check = (value, name) => {report.checks.push({name, passed: !!value}); if (!value) throw Error(name);};
  await IOUtils.writeUTF8(reportPath, JSON.stringify(report));
  await Zotero.initializationPromise;
  check(PathUtils.normalize(Zotero.DataDirectory.dir) === PathUtils.normalize(dataPath), 'disposable data directory is isolated from the user library');
  const libraryID = Zotero.Libraries.userLibraryID;
  check((await Zotero.Items.getAll(libraryID)).length === 0, 'disposable library starts empty');
  const scope = {};
  Services.scriptloader.loadSubScript(rootURI + 'runtime.js', scope);
  const runtime = Object.create(scope.CustomStyleRuntime.prototype);
  Object.assign(runtime, {Z: Zotero, active: true});
  const paper = new Zotero.Item('journalArticle'); paper.libraryID = libraryID;
  paper.setField('title', 'System-default launch test'); paper.setField('extra', 'Rating: 4');
  await paper.saveTx({skipNotifier: true});
  const note = new Zotero.Item('note'); note.libraryID = libraryID; note.parentID = paper.id;
  note.setNote('<p>Keep this note</p>'); await note.saveTx({skipNotifier: true});
  const linkedPath = PathUtils.join(dataPath, 'linked file.txt'); await IOUtils.writeUTF8(linkedPath, 'Fixture');
  const linked = new Zotero.Item('attachment'); linked.libraryID = libraryID; linked.parentID = paper.id;
  linked.setField('title', 'Linked text'); linked.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
  linked.attachmentPath = linkedPath; linked.attachmentContentType = 'text/plain'; await linked.saveTx({skipNotifier: true});
  const pdf = new Zotero.Item('attachment'); pdf.libraryID = libraryID; pdf.parentID = paper.id;
  const filename = '论文 $(literal) & [draft].pdf';
  pdf.setField('title', 'Stored PDF'); pdf.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
  pdf.attachmentPath = 'storage:' + filename; pdf.attachmentContentType = 'application/pdf'; await pdf.saveTx({skipNotifier: true});
  const storage = Zotero.Attachments.getStorageDirectory(pdf).path;
  check(PathUtils.normalize(storage).replace(/\\/g, '/').startsWith(PathUtils.normalize(dataPath).replace(/\\/g, '/') + '/'), 'stored attachment directory remains inside the disposable library');
  await IOUtils.makeDirectory(storage, {ignoreExisting: true, createAncestors: true});
  const pdfPath = PathUtils.join(storage, filename);
  await IOUtils.writeUTF8(pdfPath, '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
  await paper.loadAllData(); await paper.reload(['childItems'], true);
  const before = JSON.stringify(paper.toJSON()), noteBefore = note.getNote();
  let selection = [paper]; const win = {ZoteroPane: {getSelectedItems: () => selection}, closed: false};
  const launchFile = Zotero.launchFile, readerOpen = Zotero.Reader.open, handlerOpen = Zotero.FileHandlers.open;
  const pref = Zotero.Prefs.get('fileHandler.pdf');
  const launches = []; let readerCalls = 0, handlerCalls = 0;
  try {
    Zotero.launchFile = path => {launches.push(path);};
    Zotero.Reader.open = () => {readerCalls++; throw Error('Unexpected internal reader');};
    Zotero.FileHandlers.open = () => {handlerCalls++; throw Error('Unexpected configured reader handler');};
    Zotero.Prefs.set('fileHandler.pdf', '');
    check(runtime.canOpenWithSystemDefault(win), 'native regular item enables the command');
    const result = await runtime.openWithSystemDefault(win);
    check(result.opened === 1 && result.missing === 0 && result.failed === 0, 'regular item resolves and opens its native main attachment');
    check(launches[0] === pdfPath, 'native best-attachment ordering prefers PDF over the older linked text file');
    check(Zotero.Prefs.get('fileHandler.pdf') === '', 'internal-reader preference remains unchanged');
    Zotero.Prefs.set('fileHandler.pdf', 'C:\\TestReader\\custom.exe');
    selection = [paper, pdf]; launches.length = 0;
    const deduplicated = await runtime.openWithSystemDefault(win);
    check(deduplicated.opened === 1 && launches.length === 1 && launches[0] === pdfPath, 'parent and selected PDF resolve once to the real stored file');
    check(Zotero.Prefs.get('fileHandler.pdf') === 'C:\\TestReader\\custom.exe', 'custom-reader preference remains unchanged');
    selection = [linked]; launches.length = 0;
    check((await runtime.openWithSystemDefault(win)).opened === 1 && launches[0] === linkedPath, 'direct attachment selection resolves its native linked-file path');
    const standalone = new Zotero.Item('attachment'); standalone.libraryID = libraryID;
    standalone.setField('title', 'Standalone text'); standalone.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
    standalone.attachmentPath = linkedPath; standalone.attachmentContentType = 'text/plain'; await standalone.saveTx({skipNotifier: true});
    selection = [standalone]; launches.length = 0;
    check((await runtime.openWithSystemDefault(win)).opened === 1 && launches[0] === linkedPath, 'standalone native file attachment opens without a parent');
    const missing = new Zotero.Item('attachment'); missing.libraryID = libraryID;
    missing.setField('title', 'Missing file'); missing.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
    missing.attachmentPath = PathUtils.join(dataPath, 'missing.pdf'); missing.attachmentContentType = 'application/pdf'; await missing.saveTx({skipNotifier: true});
    selection = [missing]; launches.length = 0;
    const unavailable = await runtime.openWithSystemDefault(win);
    check(unavailable.missing === 1 && unavailable.opened === 0 && launches.length === 0, 'a missing native file never reaches the OS launcher');
    selection = [note];
    check(!runtime.canOpenWithSystemDefault(win), 'native note-only selection disables the command');
    check((await runtime.openWithSystemDefault(win)).skipped === 1, 'native notes are not treated as file attachments');
    check(readerCalls === 0 && handlerCalls === 0, 'the action bypasses internal and configured Zotero reader handlers');
    check(JSON.stringify(paper.toJSON()) === before && note.getNote() === noteBefore, 'item metadata, rating and note remain unchanged');
    check(paper.getAttachments().includes(pdf.id) && paper.getAttachments().includes(linked.id), 'attachment relationships remain unchanged');
  } finally {
    Zotero.launchFile = launchFile; Zotero.Reader.open = readerOpen; Zotero.FileHandlers.open = handlerOpen;
    if (pref == null) Zotero.Prefs.clear('fileHandler.pdf'); else Zotero.Prefs.set('fileHandler.pdf', pref);
  }
  check(Zotero.Prefs.get('fileHandler.pdf') === pref, 'test reader preference is restored');
  report.zoteroVersion = Zotero.version; report.state = 'complete'; await finish(report);
}
