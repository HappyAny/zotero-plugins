const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/crossref-jwmx-j2pg.json')));
const chapter = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/crossref-book-chapter.json')));
const source = fs.readFileSync(path.join(__dirname, '../chrome/content/doiManager.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}

function fixture({record = real, doi = real.DOI, type = 'preprint', request, failSave = false, extra,
  title = 'Quantum dispersive waves and multimode squeezing in pure-kerr parametrically driven cavity solitons'} = {}) {
  const types = {preprint: 1, journalArticle: 2, conferencePaper: 3, bookSection: 4};
  const fields = {title,
    DOI: doi, url: 'https://arxiv.org/abs/2605.03995', date: '2026-05-06',
    extra: extra === undefined ? 'Rating: 4\nRead_Status: Read\nDOI Fix previous DOI: 10.48550/arxiv.2605.03995' : extra,
    repository: 'arXiv', archiveID: '2605.03995', versionNumber: '1',
    abstractNote: 'Original abstract', citationKey: 'OriginalCiteKey'};
  const creators = [{creatorType: 'author', firstName: 'Original', lastName: 'Author'}];
  const tags = [{tag: 'physics', type: 1}], collections = [4, 8], notes = [55], attachments = [56];
  let current = {itemType: type, ...fields, creators, tags, collections}, persisted = clone(current), changed = false;
  let fail = failSave, throwField = '', saves = 0;
  const requests = [], lines = [], errors = [];
  const valid = (name, id) => !['repository', 'archiveID', 'versionNumber'].includes(name)
    && !([types.conferencePaper, types.bookSection].includes(id) && ['ISSN', 'issue'].includes(name))
    && !(['publisher', 'ISBN'].includes(name) && id !== types.bookSection);
  const item = {id: 8563, key: 'PTWKA7EV', libraryID: 1, deleted: false,
    get itemTypeID() {return types[current.itemType];},
    isEditable: () => true, isRegularItem: () => true,
    getField: name => current[name] || '',
    setField(name, value) {if (name === throwField) throw Error('Injected field failure'); current[name] = value; changed = true;},
    getCreators: () => clone(current.creators),
    setCreators(value) {current.creators = clone(value); changed = true;},
    getFieldsNotInType: id => Object.keys(fields).filter(name => current[name] && !valid(name, id)),
    setType(id) {current.itemType = Object.keys(types).find(name => types[name] === id);
      for (const name of Object.keys(fields)) if (!valid(name, id)) delete current[name];
      changed = true; return true;},
    toJSON: () => clone(current), hasChanged: () => changed,
    async saveTx() {saves++; if (fail) {current = clone(persisted); changed = false; throw Error('Injected save failure');}
      persisted = clone(current); changed = false;},
    async reload() {current = clone(persisted); changed = false;}, _clearChanged() {changed = false;},
    getAttachments: () => attachments, getNotes: () => notes, getCollections: () => current.collections,
    addTag(tag) {current.tags.push({tag}); changed = true;},
    removeTag(tag) {current.tags = current.tags.filter(t => t.tag !== tag);},
  };
  const Z = {debug() {}, logError: error => errors.push(error),
    HTTP: {async request(...args) {requests.push(args); return request ? request(...args)
      : {status: 200, response: JSON.stringify({message: record})};}},
    ItemTypes: {getID: type => types[type] || false},
    ItemFields: {getID: name => name, getName: name => name, isValidForType: valid},
    getActiveZoteroPane: () => ({getSelectedItems: () => [item]}),
    ProgressWindow: class {changeHeadline() {} show() {} addLines(line) {lines.push(line);} startCloseTimer() {}},
    alert() {throw Error('Unexpected alert');},
  };
  const context = {doiManager: {}, Zotero: Z, URLSearchParams};
  vm.createContext(context); vm.runInContext(source, context);
  const original = clone(current);
  return {manager: context.doiManager, item, requests, lines, errors, original, notes, attachments,
    current: () => clone(current), persisted: () => clone(persisted), saves: () => saves,
    edit(name, value) {current[name] = value; changed = true;},
    failField(name) {throwField = name;}, allowSave() {fail = false;}};
}

test('real Crossref record upgrades this arXiv preprint in place and retains reading data and attachments', async () => {
  const f = fixture(), result = await f.manager.updatePublishedMetadata(f.item), now = f.current();
  assert.equal(result.changed, true); assert.equal(result.type, 'journalArticle');
  assert.equal(now.itemType, 'journalArticle'); assert.equal(now.publicationTitle, 'Physical Review Letters');
  assert.equal(now.date, '2026-10-28'); assert.equal(now.DOI, '10.1103/jwmx-j2pg');
  assert.equal(now.volume, undefined, 'missing published volume must remain unknown');
  assert.equal(now.abstractNote, f.original.abstractNote); assert.equal(now.citationKey, 'OriginalCiteKey');
  assert.ok(now.extra.startsWith(f.original.extra + '\n'));
  assert.ok(now.extra.includes('arXiv: 2605.03995'));
  const backup = JSON.parse(now.extra.split('\n').find(line => line.startsWith('DOI Fix preprint metadata: ')).slice(27));
  assert.equal(backup.fields.versionNumber, '1'); assert.equal(backup.fields.repository, 'arXiv');
  assert.equal(backup.fields.archiveID, '2605.03995'); assert.equal(backup.fields.url, f.original.url);
  assert.deepEqual(now.tags, f.original.tags); assert.deepEqual(now.collections, f.original.collections);
  assert.deepEqual(f.item.getNotes(), [55]); assert.deepEqual(f.item.getAttachments(), [56]);
  assert.equal(f.item.key, 'PTWKA7EV'); assert.equal(f.item.id, 8563); assert.equal(f.item.libraryID, 1);
  assert.equal(f.saves(), 1); assert.equal(f.item.hasChanged(), false);
  assert.equal((await f.manager.updatePublishedMetadata(f.item)).reason, 'not-preprint');
  assert.equal(f.requests.length, 1, 'an upgraded item is not fetched again');
});

test('Crossref proceedings become a conference paper with its proceedings title', async () => {
  const record = {...real, type: 'proceedings-article', 'container-title': ['Optical conference proceedings'], volume: '12', issue: '3', page: '23-27', ISSN: ['1234-5678']};
  const f = fixture({record}); await f.manager.updatePublishedMetadata(f.item); const now = f.current();
  assert.equal(now.itemType, 'conferencePaper'); assert.equal(now.proceedingsTitle, 'Optical conference proceedings');
  assert.equal(now.publicationTitle, undefined); assert.equal(now.issue, undefined); assert.equal(now.ISSN, undefined);
  assert.equal(now.pages, '23-27');
});

test('a preprint DOI and a non-preprint item make no additional network requests', async () => {
  for (const options of [{doi: '10.48550/arxiv.2605.03995'}, {type: 'journalArticle'}]) {
    const f = fixture(options); assert.equal((await f.manager.updatePublishedMetadata(f.item)).changed, false);
    assert.equal(f.requests.length, 0); assert.equal(f.saves(), 0); assert.deepEqual(f.current(), f.original);
  }
});

test('a successful DOI lookup alone cannot convert a posted-content record or unknown metadata', async () => {
  for (const record of [{...real, type: 'posted-content'}, {...real, DOI: '10.0000/another'}, {...real, 'container-title': []}, {...real, title: ['Completely different paper']}]) {
    const f = fixture({record}); assert.equal((await f.manager.updatePublishedMetadata(f.item)).changed, false);
    assert.deepEqual(f.current(), f.original); assert.equal(f.saves(), 0);
  }
});

test('network failure retains the DOI and all preprint data', async () => {
  const f = fixture({request: async () => {throw Error('Offline');}});
  assert.equal((await f.manager.updatePublishedMetadata(f.item)).reason, 'metadata-unavailable');
  assert.deepEqual(f.current(), f.original); assert.equal(f.saves(), 0);
});

test('the metadata result cannot overwrite an edit made during the network request', async () => {
  let resolve;
  const f = fixture({request: () => new Promise(done => {resolve = done;})});
  const work = f.manager.updatePublishedMetadata(f.item);
  f.edit('title', 'My corrected title'); resolve({status: 200, response: JSON.stringify({message: real})});
  assert.equal((await work).reason, 'item-changed'); assert.equal(f.current().title, 'My corrected title');
  assert.equal(f.current().itemType, 'preprint'); assert.equal(f.saves(), 0);
});

test('read-only, deleted, or already edited items are left alone', async () => {
  for (const condition of ['read-only', 'deleted', 'edited']) {
    const f = fixture();
    if (condition === 'read-only') f.item.isEditable = () => false;
    if (condition === 'deleted') f.item.deleted = true;
    if (condition === 'edited') f.edit('extra', 'Pending user edit');
    assert.equal((await f.manager.updatePublishedMetadata(f.item)).changed, false);
    assert.equal(f.requests.length, 0); assert.equal(f.saves(), 0);
  }
});

test('both selected DOI commands skip unsaved, read-only, deleted, and already edited items before lookup', async () => {
  for (const command of ['updateDOIForSelectedItems', 'retrieveDOIForSelectedItems']) {
    for (const doi of [real.DOI, '']) {
      for (const condition of ['unsaved', 'read-only', 'deleted', 'edited']) {
        const f = fixture({doi});
        if (condition === 'unsaved') f.item.id = null;
        if (condition === 'read-only') f.item.isEditable = () => false;
        if (condition === 'deleted') f.item.deleted = true;
        if (condition === 'edited') f.edit('extra', 'Pending user edit');
        const before = f.current(), changed = f.item.hasChanged();
        await f.manager[command]();
        assert.deepEqual(f.current(), before, `${command}: ${condition}`);
        assert.deepEqual(f.persisted(), f.original);
        assert.equal(f.requests.length, 0); assert.equal(f.saves(), 0);
        assert.equal(f.item.hasChanged(), changed);
      }
    }
  }
});

test('selected DOI commands preserve publication fields and creators edited during validation, including saved edits', async () => {
  const edits = [
    ['publicationTitle', 'My corrected journal'],
    ['creators', [{creatorType: 'author', firstName: 'My', lastName: 'Correction'}]],
  ];
  for (const command of ['updateDOIForSelectedItems', 'retrieveDOIForSelectedItems']) {
    for (const [field, value] of edits) {
      for (const saved of [false, true]) {
        const started = deferred(), response = deferred();
        const f = fixture({request: () => {started.resolve(); return response.promise;}});
        const work = f.manager[command]();
        await started.promise;
        f.edit(field, value);
        if (saved) await f.item.saveTx();
        const before = f.current(), persisted = f.persisted(), saves = f.saves();
        response.resolve({status: 200, response: JSON.stringify({message: real})});
        await work;
        assert.deepEqual(f.current(), before, `${command}: ${field}, saved=${saved}`);
        assert.deepEqual(f.persisted(), persisted); assert.equal(f.saves(), saves);
        assert.equal(f.item.hasChanged(), !saved); assert.equal(f.requests.length, 1);
      }
    }
  }
});

test('both selected commands skip DOI writes and failure tags when discovery observes an intervening change', async () => {
  for (const command of ['updateDOIForSelectedItems', 'retrieveDOIForSelectedItems']) {
    for (const resolved of [false, true]) {
      for (const condition of ['edited', 'read-only', 'deleted']) {
        const started = deferred(), discovery = deferred();
        const f = fixture({doi: command === 'updateDOIForSelectedItems' ? '10.48550/arxiv.2605.03995' : ''});
        f.manager.validateDOIForItem = async () => ({valid: true, matchesItem: false});
        f.manager.retrieveDOIResult = () => {started.resolve(); return discovery.promise;};
        const work = f.manager[command]();
        await started.promise;
        assert.deepEqual(f.current(), f.original, 'discovery must not leave a pending mismatch tag');
        if (condition === 'edited') f.edit('publicationTitle', 'My corrected journal');
        if (condition === 'read-only') f.item.isEditable = () => false;
        if (condition === 'deleted') f.item.deleted = true;
        const before = f.current();
        discovery.resolve(resolved ? {doi: real.DOI, source: 'test'}
          : {doi: null, status: 'not-found', message: 'No candidate'});
        await work;
        assert.deepEqual(f.current(), before, `${command}: ${condition}, resolved=${resolved}`);
        assert.deepEqual(f.persisted(), f.original); assert.equal(f.saves(), 0);
      }
    }
  }
});

test('selected DOI commands preserve edits made while loading native item data', async () => {
  for (const command of ['updateDOIForSelectedItems', 'retrieveDOIForSelectedItems']) {
    const f = fixture();
    f.item.loadAllData = async () => {f.edit('extra', 'Edited while loading');};
    await f.manager[command]();
    assert.equal(f.current().extra, 'Edited while loading');
    assert.equal(f.requests.length, 0); assert.equal(f.saves(), 0);
    assert.deepEqual(f.persisted(), f.original);
  }
});

test('unrelated repetitive titles cannot pass the publication conversion guard in either direction', async () => {
  for (const [title, publishedTitle] of [
    ['A rose is a rose is a rose', 'Rose petal development'],
    ['Rose petal development', 'A rose is a rose is a rose'],
    ['rose '.repeat(30), 'Rose petal development'],
    ['Rose petal development', 'rose '.repeat(30)],
  ]) {
    const f = fixture({title, record: {...real, title: [publishedTitle]}});
    assert.equal((await f.manager.updatePublishedMetadata(f.item)).reason, 'title-mismatch');
    assert.deepEqual(f.current(), f.original); assert.equal(f.saves(), 0);
  }
});

test('mixed-case DOI identity permits conversion and retains the stored spelling through both selected commands', async () => {
  for (const command of ['updatePublishedMetadata', 'updateDOIForSelectedItems', 'retrieveDOIForSelectedItems']) {
    for (const [doi, recordDOI] of [[real.DOI, real.DOI.toUpperCase()], ['10.1103/JwMx-J2Pg', real.DOI]]) {
      const f = fixture({doi, record: {...real, DOI: recordDOI}});
      await f.manager[command](f.item);
      assert.equal(f.current().itemType, 'journalArticle', `${command}: ${doi} / ${recordDOI}`);
      assert.equal(f.current().DOI, doi); assert.equal(f.requests.length, 1);
    }
  }
});

test('a saved case-only DOI edit during lookup is still an intervening edit', async () => {
  for (const command of ['updatePublishedMetadata', 'updateDOIForSelectedItems', 'retrieveDOIForSelectedItems']) {
    const started = deferred(), response = deferred();
    const f = fixture({request: () => {started.resolve(); return response.promise;}});
    const work = f.manager[command](f.item);
    await started.promise;
    f.edit('DOI', real.DOI.toUpperCase()); await f.item.saveTx();
    const before = f.current();
    response.resolve({status: 200, response: JSON.stringify({message: real})});
    await work;
    assert.deepEqual(f.current(), before, command); assert.deepEqual(f.persisted(), before);
    assert.equal(f.saves(), 1); assert.equal(f.item.hasChanged(), false);
  }
});

test('native save failure and pre-save field failure restore the original item data', async () => {
  for (const stage of ['save', 'field']) {
    const f = fixture({failSave: stage === 'save'});
    if (stage === 'field') f.failField('publicationTitle');
    await assert.rejects(f.manager.updatePublishedMetadata(f.item), /Injected/);
    assert.deepEqual(f.current(), f.original); assert.deepEqual(f.persisted(), f.original);
    assert.equal(f.item.hasChanged(), false);
  }
});

test('parallel requests for one item share a lookup and one conversion', async () => {
  const f = fixture();
  const results = await Promise.all([f.manager.updatePublishedMetadata(f.item), f.manager.updatePublishedMetadata(f.item)]);
  assert.ok(results.every(result => result.changed)); assert.equal(f.requests.length, 1); assert.equal(f.saves(), 1);
});

test('batch items load all native data before serialization and preserve an intervening edit', async () => {
  const f = fixture();
  let loaded = false;
  f.item.loadAllData = async () => {loaded = true; f.edit('extra', 'Edited while loading');};
  assert.equal((await f.manager.updatePublishedMetadata(f.item)).reason, 'item-changed');
  assert.ok(loaded); assert.equal(f.requests.length, 0); assert.equal(f.current().extra, 'Edited while loading');
});

test('Extra retains its original whitespace as well as its rating and text', async () => {
  const extra = '\n  User note with spaces  \nRating: 4\n\n';
  const f = fixture({extra}); await f.manager.updatePublishedMetadata(f.item);
  assert.ok(f.current().extra.startsWith(extra + '\n'));
});

test('missing authors and partial dates do not erase creators or invent a month and day', async () => {
  const record = {...real, author: [], published: {'date-parts': [[2026]]},
    'published-print': undefined, 'published-online': undefined, issued: undefined};
  const f = fixture({record}); await f.manager.updatePublishedMetadata(f.item);
  assert.deepEqual(f.current().creators, f.original.creators); assert.equal(f.current().date, '2026');
});

test('Update DOI also upgrades an already verified formal DOI without fetching it twice', async () => {
  const f = fixture(); await f.manager.updateDOIForSelectedItems();
  assert.equal(f.current().itemType, 'journalArticle'); assert.equal(f.requests.length, 1);
  assert.ok(f.lines.some(line => line.includes('Publication information updated: Journal Article')));
  assert.ok(f.lines.some(line => line.includes('1 updated, 0 unchanged, 0 failed')));
});

test('Retrieve DOI upgrades the previously fixed preprint instead of skipping its existing DOI', async () => {
  const f = fixture(); await f.manager.retrieveDOIForSelectedItems();
  assert.equal(f.current().itemType, 'journalArticle'); assert.equal(f.requests.length, 1);
  assert.ok(f.lines.some(line => line.includes('1 succeeded, 0 skipped, 0 failed')));
});

test('a newly retrieved DOI and a changed arXiv DOI both trigger the publication update', async () => {
  for (const doi of ['', '10.48550/arxiv.2605.03995']) {
    const f = fixture({doi});
    f.manager.validateDOIForItem = async () => ({valid: false, matchesItem: false});
    f.manager.retrieveDOIResult = async () => ({doi: real.DOI, source: 'test'});
    await f.manager.updateDOIForSelectedItems();
    assert.equal(f.current().itemType, 'journalArticle'); assert.equal(f.current().DOI, real.DOI);
    assert.ok(f.current().extra.startsWith(f.original.extra));
  }
});

test('a metadata update failure is reported separately while the retrieved DOI stays saved', async () => {
  const f = fixture({doi: ''});
  f.manager.retrieveDOIResult = async () => ({doi: real.DOI, source: 'test'});
  f.failField('publicationTitle'); await f.manager.retrieveDOIForSelectedItems();
  assert.equal(f.current().DOI, real.DOI); assert.equal(f.current().itemType, 'preprint');
  assert.ok(f.lines.some(line => line.includes('DOI saved; publication information update failed')));
  assert.equal(f.current().extra, f.original.extra);
});

test('the actual Elsevier book chapter converts through Update DOI and keeps the original item relationships', async () => {
  const f = fixture({record: chapter, title: chapter.title[0], doi: chapter.DOI});
  await f.manager.updateDOIForSelectedItems();
  const now = f.current();
  assert.equal(now.itemType, 'bookSection');
  assert.equal(now.bookTitle, 'Topological Photonics');
  assert.equal(now.ISBN, '9780443134470'); assert.equal(now.publisher, 'Elsevier');
  assert.equal(now.pages, '27-65'); assert.equal(now.date, '2027');
  assert.equal(now.DOI, chapter.DOI); assert.equal(now.publicationTitle, undefined); assert.equal(now.proceedingsTitle, undefined);
  assert.equal(now.creators.length, 10); assert.equal(now.creators[0].lastName, 'Xia');
  assert.deepEqual(now.tags, f.original.tags); assert.deepEqual(now.collections, f.original.collections);
  assert.equal(f.item.key, 'PTWKA7EV'); assert.deepEqual(f.item.getAttachments(), [56]); assert.deepEqual(f.item.getNotes(), [55]);
  assert.ok(now.extra.startsWith(f.original.extra + '\n')); assert.ok(now.extra.includes('DOI Fix preprint metadata: '));
  assert.equal(f.requests.length, 1); assert.equal(f.item.hasChanged(), false);
  assert.ok(f.lines.some(line => line.includes('Publication information updated: Book Section')));
  assert.ok(f.lines.some(line => line.includes('1 updated, 0 unchanged, 0 failed')));
});

test('Retrieve DOI also converts a known book-chapter DOI and a failed field update rolls back safely', async () => {
  const f = fixture({record: chapter, title: chapter.title[0], doi: chapter.DOI});
  await f.manager.retrieveDOIForSelectedItems(); assert.equal(f.current().itemType, 'bookSection');
  const failed = fixture({record: chapter, title: chapter.title[0], doi: chapter.DOI});
  failed.failField('bookTitle');
  await failed.manager.updateDOIForSelectedItems();
  assert.deepEqual(failed.current(), failed.original); assert.deepEqual(failed.persisted(), failed.original);
  assert.equal(failed.item.hasChanged(), false);
  assert.ok(failed.lines.some(line => line.includes('publication information update failed')));
});

test('an unsupported Crossref publication type is reported explicitly without changing the item type', async () => {
  const f = fixture({record: {...real, type: 'book'}});
  await f.manager.updateDOIForSelectedItems();
  assert.deepEqual(f.current(), f.original);
  assert.ok(f.lines.some(line => line.includes('unsupported Crossref type (book)')));
});
