import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const I18N=require('../src/i18n.js'),Strings=require('../src/strings.js');
const Schema=require('../src/settings-schema.js');
const Runtime=require('../src/runtime.js');
const PaperTranslate=require('../src/paper-translate.js');

test('all Chinese messages preserve the Korean interpolation contract', () => {
 assert.ok(Object.keys(Strings.zh).length>=2964);
 assert.deepEqual(Object.keys(Strings.zh).sort(),Object.keys(Strings.en).sort());
 const holes=s=>(s.match(/\{\d+\}/g)||[]).sort();
 for(const[key,value]of Object.entries(Strings.zh)){
  assert.equal(typeof value,'string',key);
  assert.ok(value.length,key);
  assert.deepEqual(holes(value),holes(key),key);
  assert.doesNotMatch(value,/[가-힣]/,key);
 }
});

test('Chinese switches at runtime and preserves names inserted in messages', () => {
 I18N.load(Strings);
 for(const value of ['zh-CN','zh_CN','zh-Hans','zh-Hans-CN']){
  assert.equal(I18N.use(value),'zh-CN');
  assert.equal(I18N.t('보유 문헌'),'资料库');
  assert.equal(I18N.t('학위논문'),'学位论文');
  assert.equal(I18N.aiLanguage(),'Simplified Chinese');
 }
 assert.equal(I18N.use('auto',{locale:'zh-CN'}),'zh-CN');
 const raw='User title: 1 papers 학위논문 {0}';
 assert.ok(I18N.format('비교 항목: {0}',[raw]).includes(raw));
 assert.equal(Runtime.prototype.text.call({i18n:I18N,t:s=>I18N.t(s)},'Select a reference first.','먼저 문헌을 선택하세요.'),'请先选择一篇文献。');
 I18N.use('en-US');
 assert.equal(I18N.t('보유 문헌'),'Library');
});

test('settings accept a Chinese interface and Chinese AI output independently', () => {
 assert.equal(Schema.validate('language','zh-CN'),'zh-CN');
 assert.equal(Schema.validate('aiLanguage','Simplified Chinese'),'Simplified Chinese');
 assert.equal(PaperTranslate.targetOf('auto',false,'','zh-CN').code,'ZH-HANS');
 assert.equal(PaperTranslate.targetOf('EN-US',false,'','zh-CN').code,'EN-US');
 assert.equal(PaperTranslate.targetOf('auto',false,'de-DE','zh-CN').code,'DE');
});

test('Chinese terms follow their reader or library context without changing paper text',()=>{
 I18N.load(Strings);I18N.use('zh-CN');
 try{
  assert.equal(I18N.t('본문','reader-assist'),'正文');
  assert.equal(I18N.t('문장','reader-assist'),'朗读文本');
  assert.equal(I18N.t('읽기'),'阅读');
  assert.equal(I18N.t('읽기','reader-assist'),'朗读');
  assert.equal(I18N.t('이어 읽기'),'继续阅读');
  assert.equal(I18N.t('이어 읽기','reader-assist'),'继续朗读');
  assert.equal(I18N.t('만들기','reader-assist'),'生成音频');
  assert.equal(I18N.t('English','reader-assist'),'英语');
  assert.equal(I18N.t('身体与健康：成绩单与研究原文'),'身体与健康：成绩单与研究原文');
  for(const values of Object.values(Strings.contexts['zh-CN']))for(const[key,value]of Object.entries(values)){
   assert.deepEqual(value.match(/\{\d+\}/g)||[],key.match(/\{\d+\}/g)||[]);
  }
 }finally{I18N.use('en-US');}
});
