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

test('complete Chinese sentences preserve counts, source IDs, titles and import outcomes',()=>{
 const t=I18N.make('zh');
 assert.equal(t('personSub',2),'2 篇论文使用了这一姓名。请确认研究者；同一人的多种署名可以多选。');
 assert.equal(t('searchStopped',3),'检索已停止，已获取 3 条结果。');
 assert.equal(t('metricsLoadedOf',20,5),'作者档案共 20 篇论文，本次依据其中 5 篇计算。');
 assert.equal(t('importDone',3,2,4,1,true),'已完成：添加 3 篇（其中 2 篇附有 PDF）；已收录 4 篇；失败 1 篇；已提前停止。');
 assert.match(t('importFailures',2),/^2 篇添加失败，仍被勾选/);
 assert.match(t('importFailuresPdf',2,3),/另有 3 篇已保存，但缺少 PDF/);
 assert.match(t('relLowConf',3),/3 篇.*500.*施引关联/);
 assert.equal(t('relProgress',2,8),'正在按库内关联排序，请求 2/8');
 assert.match(t('relDone',2,8,4),/2\/8.*4 次 OpenAlex 请求/);
 assert.match(t('metricsUnknown',2,5),/共 5 篇论文，其中 2 篇被引次数未知/);
 assert.match(t('pinShown',3),/新增 3 篇.*标记/);
 assert.match(t('historyRevalidated',2),/^2 条已保存结果不再符合检索条件/);
 const original='身体与健康学位论文 {0} user=ABC 가';
 assert.ok(t('watchAuthorTip',original).includes(original));
 assert.ok(t('adding',1,2,original).includes(original));
 for(const key of ['sigCitedByMine','sigCitesMine','relDoneCached','relPartial','relCoverage']){
  assert.doesNotMatch(t(key,2,5,3),/of my papers|of yours|Ranked|by your library|not counted/);
 }
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
