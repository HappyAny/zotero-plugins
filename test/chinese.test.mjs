import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import I18N from '../content/i18n.js';
import Translate from '../content/translate.js';
import {buildPreview} from '../scripts/search-preview.mjs';

test('Simplified Chinese resolves explicitly and through the Zotero locale', () => {
 for (const locale of ['zh','zh-CN','zh_CN','zh-Hans','zh-Hans-CN',' ZH-cn ']) {
  assert.equal(I18N.resolveLocale(locale),'zh');
  assert.equal(I18N.make(locale)('search'),'搜索');
 }
 assert.equal(I18N.resolveLocale('auto','zh-CN'),'zh');
 assert.equal(I18N.resolveLocale('auto','zh-Hans'),'zh');
 assert.equal(I18N.resolveLocale('zh-TW'),'en');
});

test('Chinese preserves every string key, value type and machine export header', () => {
 const en=I18N.STRINGS.en,zh=I18N.STRINGS.zh;
 assert.deepEqual(Object.keys(zh).sort(),Object.keys(en).sort());
 for(const key of Object.keys(en)){
  assert.equal(typeof zh[key],typeof en[key],key);
  if(typeof zh[key]==='string')assert.doesNotMatch(zh[key],/[가-힣]/,key);
 }
 assert.deepEqual(zh.csvHead,en.csvHead);
 assert.match(zh.authorProfilesFound(2),/2.*作者档案/);
 const title='Untouched title: 학위논문 {0}';
 assert.ok(zh.adding(2,10,title).includes(title),'A title is inserted after translating the UI.');
});

test('Chinese error, progress and translation language names cover real service paths', () => {
 assert.match(I18N.explainError('HTTP 429 · api.openalex.org','zh'),/OpenAlex/);
 assert.match(I18N.explainError('Start year must not exceed end year','zh'),/年/);
 assert.match(I18N.localizeProgress('Citation counts: 2 / 10','zh'),/被引次数.*2 \/ 10/);
 assert.equal(Translate.languageName('ko','zh'),'韩语');
 assert.equal(Translate.languageName('zh-CN','zh-CN'),'简体中文');
});

test('the real search markup and controllers render Chinese without a network', async () => {
 const out=await buildPreview({locale:'zh'});
 assert.ok(out.rows>=10);
 assert.match(out.results,/搜索/);
 assert.match(out.results,/作者/);
 assert.doesNotMatch(out.results,/[가-힣]/);
 assert.equal(out.trace.columns.basic,'basic');
 assert.equal(out.trace.columns.all,'all');
 assert.equal(out.trace.menu.labels.length,11);
 const sources=fs.readFileSync(new URL('../content/search.xhtml',import.meta.url),'utf8');
 assert.ok(sources.indexOf('content/i18n-zh.js')<sources.indexOf('content/i18n.js'));
});
