var doiManager = {};
var nativeTestReport = {state: 'running', checks: []};
var nativeTestTimer;
var nativeTestFinished = false;
const nativeTestReportPath = __REPORT_PATH__;
const nativeTestDataPath = __DATA_PATH__;
function install() {}
function uninstall() {}
function shutdown() {}
function startup(data) {
  Services.startup.enterLastWindowClosingSurvivalArea();
  nativeTestTimer = Components.classes['@mozilla.org/timer;1'].createInstance(Components.interfaces.nsITimer);
  nativeTestTimer.initWithCallback({notify() {
    finish({ ...nativeTestReport, state: 'failed', error: 'Native API test exceeded 45 seconds'});
  }}, 45000, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  run(data).catch(error => finish({...nativeTestReport, state: 'failed', error: String(error), stack: error.stack}));
}
async function finish(report) {
  if (nativeTestFinished) return;
  nativeTestFinished = true;
  nativeTestTimer.cancel();
  try { await IOUtils.writeUTF8(nativeTestReportPath, JSON.stringify(report, null, 2)); }
  finally {
    Services.startup.exitLastWindowClosingSurvivalArea();
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  }
}
async function run({rootURI}) {
  const report = nativeTestReport;
  report.managerSHA256 = __MANAGER_SHA__;
  report.uiNotificationsSuppressed = true;
  const check = (ok, name) => {report.checks.push({name, passed: !!ok}); if (!ok) throw Error(name);};
  report.phase = 'initializing';
  await IOUtils.writeUTF8(nativeTestReportPath, JSON.stringify(report));
  await Zotero.initializationPromise;
  check(Zotero.DataDirectory.dir.replace(/\\/g, '/') === nativeTestDataPath.replace(/\\/g, '/'), 'isolated disposable data directory');
  const libraryID = Zotero.Libraries.userLibraryID;
  check((await Zotero.Items.getAll(libraryID)).length === 0, 'empty disposable library');
  report.phase = 'native-records';
  await IOUtils.writeUTF8(nativeTestReportPath, JSON.stringify(report));
  Services.scriptloader.loadSubScript(rootURI + 'doiManager.js', {doiManager, Zotero, Services, URLSearchParams});
  await doiManager.init({id: 'doi-published-native-check@local.invalid', version: '1.2.1', rootURI});
  const record = JSON.parse(await Zotero.File.getResourceAsync(rootURI + 'record.json'));
  const metadata = {valid: true, title: record.title[0], record};
  async function preprint(publication = record) {
    const item = new Zotero.Item('preprint');
    item.libraryID = libraryID;
    const saveTx = item.saveTx;
    item.saveTx = function(options = {}) {return saveTx.call(this, {...options, skipNotifier: true});};
    item.setField('title', publication.title[0]); item.setField('DOI', publication.DOI);
    item.setField('url', 'https://arxiv.org/abs/2605.03995');
    item.setField('extra', 'Rating: 4\nRead_Status: Read\nDOI Fix previous DOI: 10.48550/arxiv.2605.03995');
    for (const [name, value] of Object.entries({repository: 'arXiv', archiveID: '2605.03995', versionNumber: '1'})) {
      const field = Zotero.ItemFields.getID(name);
      if (field && Zotero.ItemFields.isValidForType(field, item.itemTypeID)) item.setField(name, value);
    }
    item.setCreators([{creatorType: 'author', firstName: 'Original', lastName: 'Author'}]);
    await item.saveTx(); await item.loadAllData(); return item;
  }
  const item = await preprint();
  const collection = new Zotero.Collection(); collection.libraryID = libraryID; collection.name = 'DOI update test'; await collection.saveTx({skipNotifier: true});
  item.addToCollection(collection.id); item.addTag('Keep this tag', 1); await item.saveTx();
  const note = new Zotero.Item('note'); note.libraryID = libraryID; note.parentID = item.id;
  note.setNote('<p>Keep this note</p>'); await note.saveTx({skipNotifier: true});
  // A blank PDF is sufficient to retain a real native PDF annotation in this API test.
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
  let pdf = '%PDF-1.4\n', offsets = [0];
  for (let i = 0; i < objects.length; i++) {offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref = pdf.length; pdf += 'xref\n0 5\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pdfPath = PathUtils.join(Zotero.DataDirectory.dir, 'native-test.pdf');
  await IOUtils.writeUTF8(pdfPath, pdf);
  const attachment = new Zotero.Item('attachment'); attachment.libraryID = libraryID;
  attachment.parentID = item.id; attachment.setField('title', 'Native test PDF');
  attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
  attachment.attachmentPath = pdfPath; attachment.attachmentContentType = 'application/pdf';
  await attachment.saveTx({skipNotifier: true});
  const annotation = new Zotero.Item('annotation'); annotation.libraryID = libraryID; annotation.parentID = attachment.id;
  annotation.annotationType = 'highlight'; annotation.annotationText = 'Keep this annotation';
  annotation.annotationComment = 'Keep this comment'; annotation.annotationColor = '#ffd400';
  annotation.annotationPageLabel = '1'; annotation.annotationSortIndex = '00000|000000|00000';
  annotation.annotationPosition = JSON.stringify({pageIndex: 0, rects: [[10, 10, 20, 20]]});
  await annotation.saveTx({skipNotifier: true});
  await item.loadAllData();
  await item.reload(['childItems', 'tags', 'collections'], true);
  const before = item.toJSON(), key = item.key, id = item.id;
  const noteBefore = note.getNote(), annotationBefore = JSON.stringify(annotation.toJSON());
  const result = await doiManager.updatePublishedMetadata(item, {metadata});
  check(result.changed, 'native preprint converts successfully');
  check(item.itemTypeID === Zotero.ItemTypes.getID('journalArticle'), 'native item type is Journal Article');
  check(item.id === id && item.key === key && item.libraryID === libraryID, 'native identity stays unchanged');
  check(item.getField('publicationTitle') === 'Physical Review Letters', 'native journal metadata is updated');
  check(item.getField('date') === '2026-10-28', 'native publication date is updated');
  check(item.getField('extra').startsWith(before.extra + '\n'), 'existing Extra and rating remain intact');
  check(item.getField('extra').includes('arXiv: 2605.03995'), 'arXiv ID is preserved');
  check(item.getField('extra').includes('DOI Fix preprint metadata: '), 'preprint fields have a backup');
  check(item.getAttachments().includes(attachment.id) && attachment.parentID === id, 'PDF attachment stays with the original item');
  check(item.getNotes().includes(note.id) && note.getNote() === noteBefore, 'native note stays unchanged');
  check(annotation.parentID === attachment.id && JSON.stringify(annotation.toJSON()) === annotationBefore, 'native PDF annotation stays unchanged');
  check(item.getTags().some(t => t.tag === 'Keep this tag') && item.getCollections().includes(collection.id), 'tags and collections stay intact');
  check(!item.hasChanged(), 'converted native item has no pending edits');
  const storedType = await Zotero.DB.valueQueryAsync('SELECT itemTypeID FROM items WHERE itemID=?', [id]);
  check(storedType === Zotero.ItemTypes.getID('journalArticle'), 'new type is committed to SQLite');
  const again = await doiManager.updatePublishedMetadata(item, {metadata});
  check(!again.changed, 'native conversion is idempotent');
  const conference = await preprint();
  const conferenceRecord = {...record, type: 'proceedings-article', 'container-title': ['Test Conference Proceedings'],
    author: [{name: 'Test Collaboration'}]};
  await doiManager.updatePublishedMetadata(conference, {metadata: {valid: true, title: record.title[0], record: conferenceRecord}});
  check(conference.itemTypeID === Zotero.ItemTypes.getID('conferencePaper'), 'native conference type is supported');
  check(conference.getField('proceedingsTitle') === 'Test Conference Proceedings', 'native proceedings metadata is supported');
  check(conference.getCreators()[0].lastName === 'Test Collaboration', 'native institutional creator is supported');
  const failed = await preprint(), failedBefore = JSON.stringify(failed.toJSON());
  const originalSetter = failed.setField;
  failed.setField = function(name, ...args) {
    if (name === 'publicationTitle') throw Error('Injected pre-save failure');
    return originalSetter.call(this, name, ...args);
  };
  let caught;
  try { await doiManager.updatePublishedMetadata(failed, {metadata}); } catch (error) {caught = error;}
  finally { failed.setField = originalSetter; }
  check(String(caught).includes('Injected pre-save failure'), 'native field failure is surfaced');
  check(JSON.stringify(failed.toJSON()) === failedBefore && !failed.hasChanged(), 'native field failure restores cached preprint data');
  check(await Zotero.DB.valueQueryAsync('SELECT itemTypeID FROM items WHERE itemID=?', [failed.id]) === Zotero.ItemTypes.getID('preprint'), 'native field failure leaves SQLite unchanged');
  const rollback = await preprint(), rollbackBefore = JSON.stringify(rollback.toJSON());
  const originalSaveData = rollback._saveData;
  rollback._saveData = async function(env) {
    await originalSaveData.call(this, env);
    throw Error('Injected failure after SQLite writes');
  };
  let rolledBack;
  try { await doiManager.updatePublishedMetadata(rollback, {metadata}); } catch (error) {rolledBack = error;}
  finally { rollback._saveData = originalSaveData; }
  check(String(rolledBack).includes('Injected failure after SQLite writes'), 'native transaction write failure is surfaced');
  check(await Zotero.DB.valueQueryAsync('SELECT itemTypeID FROM items WHERE itemID=?', [rollback.id]) === Zotero.ItemTypes.getID('preprint'), 'native transaction rolls back the stored item type');
  check(JSON.stringify(rollback.toJSON()) === rollbackBefore && !rollback.hasChanged(), 'native transaction rollback restores cached fields and creators');

  const chapter = JSON.parse(await Zotero.File.getResourceAsync(rootURI + 'chapter.json'));
  const book = await preprint(chapter);
  book.addToCollection(collection.id); book.addTag('Keep book tag', 1); await book.saveTx();
  const bookNote = new Zotero.Item('note'); bookNote.libraryID = libraryID; bookNote.parentID = book.id;
  bookNote.setNote('<p>Keep this book note</p>'); await bookNote.saveTx({skipNotifier: true});
  const bookFile = new Zotero.Item('attachment'); bookFile.libraryID = libraryID; bookFile.parentID = book.id;
  bookFile.setField('title', 'Keep this book PDF'); bookFile.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
  bookFile.attachmentPath = pdfPath; bookFile.attachmentContentType = 'application/pdf'; await bookFile.saveTx({skipNotifier: true});
  const bookAnnotation = new Zotero.Item('annotation'); bookAnnotation.libraryID = libraryID; bookAnnotation.parentID = bookFile.id;
  for (const key of ['annotationType','annotationText','annotationComment','annotationColor','annotationPageLabel','annotationSortIndex','annotationPosition']) bookAnnotation[key] = annotation[key];
  await bookAnnotation.saveTx({skipNotifier: true});
  await book.loadAllData(); await book.reload(['childItems','tags','collections'], true);
  const bookBefore = book.toJSON(), bookID = book.id, bookKey = book.key, noteText = bookNote.getNote(), annotationText = JSON.stringify(bookAnnotation.toJSON());
  const savedRequest = Zotero.HTTP.request, savedPane = Zotero.getActiveZoteroPane, savedProgress = Zotero.ProgressWindow;
  const lines = []; let requests = 0;
  try {
    Zotero.HTTP.request = async (method, url) => {
      check(method === 'GET' && decodeURIComponent(url).toLowerCase().endsWith(chapter.DOI), 'book menu requests the exact chapter DOI');
      requests++; return {status: 200, response: JSON.stringify({message: chapter})};
    };
    Zotero.getActiveZoteroPane = () => ({getSelectedItems: () => [book]});
    Zotero.ProgressWindow = class {changeHeadline() {} show() {} addLines(line) {lines.push(line);} startCloseTimer() {}};
    await doiManager.updateDOIForSelectedItems();
  } finally {Zotero.HTTP.request = savedRequest; Zotero.getActiveZoteroPane = savedPane; Zotero.ProgressWindow = savedProgress;}
  check(book.itemTypeID === Zotero.ItemTypes.getID('bookSection'), 'Update DOI converts the native preprint into Book Section');
  check(book.getField('bookTitle') === 'Topological Photonics', 'native book title is correct');
  check(book.getField('ISBN').replace(/[^0-9X]/gi, '') === '9780443134470' && book.getField('publisher') === 'Elsevier', 'native ISBN and publisher are correct');
  check(book.getField('pages') === '27-65' && book.getField('date') === '2027', 'native chapter pages and year are correct');
  check(book.getField('DOI') === chapter.DOI && book.getField('title') === chapter.title[0], 'chapter DOI and title are preserved');
  check(book.id === bookID && book.key === bookKey && book.libraryID === libraryID, 'book identity stays unchanged');
  check(book.getAttachments().includes(bookFile.id) && bookFile.parentID === bookID, 'book PDF remains attached');
  check(book.getNotes().includes(bookNote.id) && bookNote.getNote() === noteText, 'book note remains unchanged');
  check(bookAnnotation.parentID === bookFile.id && JSON.stringify(bookAnnotation.toJSON()) === annotationText, 'book PDF annotation remains unchanged');
  check(book.getTags().some(tag => tag.tag === 'Keep book tag') && book.getCollections().includes(collection.id), 'book tags and collection remain intact');
  check(book.getField('extra').startsWith(bookBefore.extra + '\n') && book.getField('extra').includes('DOI Fix preprint metadata: '), 'book rating and prior metadata backup are retained');
  check(book.getCreators().length === 10 && book.getCreators()[0].lastName === 'Xia', 'native chapter authors are updated');
  check(!book.hasChanged(), 'book conversion leaves no pending edits');
  check(await Zotero.DB.valueQueryAsync('SELECT itemTypeID FROM items WHERE itemID=?', [bookID]) === Zotero.ItemTypes.getID('bookSection'), 'book type is committed to SQLite');
  check(lines.some(line => line.includes('Publication information updated: Book Section')), 'menu reports Book Section conversion explicitly');
  check(lines.some(line => line.includes('1 updated, 0 unchanged, 0 failed')), 'menu reports the chapter conversion as updated');
  check(requests === 1, 'book metadata is fetched only once');
  report.book = {beforeType: 'preprint', afterType: book.itemType, DOI: book.getField('DOI'), bookTitle: book.getField('bookTitle'), ISBN: book.getField('ISBN'), publisher: book.getField('publisher'), pages: book.getField('pages'), date: book.getField('date'), lines};

  report.zoteroVersion = Zotero.version; report.phase = 'complete'; report.state = 'complete';
  await finish(report);
}
