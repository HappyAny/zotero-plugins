/* The preferences pane is XUL filled in at load time from the string tables, so
   a key that exists in the markup and not in the tables shows as a blank row.
   These cover that, and the journal figures folder in particular: figures an
   institution licenses to a reader are read from the Zotero data directory and
   are never packaged with the plugin or published. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import I18N from "../content/i18n.js";
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {uiHarness} from './helpers/search-ui-harness.mjs';

const pane = readFileSync(new URL("../content/preferences.xhtml", import.meta.url), "utf8");
const keys = attribute => [...pane.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))].map(match => match[1]);

function languageFixture() {
 const {window,document}=parseHTML('<html><body>'+pane+'<p id="foreign" data-i18n="prefTitle">Another plugin</p></body></html>');
 const prefs={'extensions.zotpop.language':'zh'},writes=[],events=[],errors=[];
 const context=vm.createContext({Zotero:{locale:'en-US',ZotPoPI18N:I18N,Prefs:{get:key=>prefs[key],set:(key,value)=>{writes.push([key,value]);prefs[key]=value;}},getMainWindows:()=>[],logError:error=>errors.push(error)}});
 vm.runInContext(readFileSync(new URL('../src/zotpop.js',import.meta.url),'utf8'),context);
 const plugin=context.Zotero.ZotPoP;plugin.showJcrStatus=()=>{};plugin.updateStatusText=()=>'';
 plugin._window={closed:false,CustomEvent:window.CustomEvent,dispatchEvent:event=>events.push(event.type)};
 plugin.localizePrefs(document);
 return {window,document,prefs,writes,events,errors,plugin,control:document.getElementById('zotpop-language')};
}

test('the real preference command persists language and refreshes only ZotPoP text immediately',()=>{
 const f=languageFixture();assert.match(f.document.querySelector('[data-i18n="prefTitle"]').textContent,/查找论文/);
 f.plugin.localizePrefs(f.document);f.control.value='en';f.control.dispatchEvent(new f.window.Event('command',{bubbles:true}));f.control.dispatchEvent(new f.window.Event('change',{bubbles:true}));
 assert.equal(f.prefs['extensions.zotpop.language'],'en');assert.equal(f.writes.length,1,'command and change do not duplicate the write');
 assert.match(f.document.querySelector('[data-i18n="prefTitle"]').textContent,/Find papers/);assert.equal(f.control.value,'en');assert.equal(f.document.getElementById('foreign').textContent,'Another plugin');
 assert.deepEqual(f.events,['zotpop-language-changed']);assert.deepEqual(f.errors,[]);
 for(const choice of ['zh','ko','auto']){f.control.value=choice;f.control.dispatchEvent(new f.window.Event('change'));assert.equal(f.prefs['extensions.zotpop.language'],choice);}
 assert.match(f.document.querySelector('[data-i18n="prefTitle"]').textContent,/Find papers/);
});

test('preference notifications reload idle search pages and preserve active searches and imports',()=>{
 const ui=uiHarness({prefs:{language:'en'}});ui.prefs.language='zh';ui.emitWindow('zotpop-language-changed');assert.equal(ui.reloads.length,1);
 ui.emitWindow('zotpop-language-changed');assert.equal(ui.reloads.length,1,'already translated');
 for(const flag of ['searching','importing']){ui.state[flag]=true;ui.prefs.language='en';ui.emitWindow('zotpop-language-changed');assert.equal(ui.reloads.length,1);assert.match(ui.get('status').textContent,/langAppliesLater/);ui.state[flag]=false;}
 ui.emitWindow('zotpop-language-changed');assert.equal(ui.reloads.length,2);
});

test("every string the preferences pane asks for exists in both languages", () => {
	const asked = [...keys("data-i18n"), ...keys("data-i18n-value"), ...keys("data-i18n-label")];
	assert.ok(asked.length > 20, "the pane is filled in from the tables");
	const missing = [];
	for (const locale of ["en", "ko"]) {
		for (const key of asked) {
			const value = I18N.STRINGS[locale][key];
			if (typeof value !== "string" || !value.trim()) missing.push(`${locale}: ${key}`);
		}
	}
	assert.deepEqual(missing, [], "these rows would render blank");
});

test("the pane names the folder journal figures are read from, and what goes in it", () => {
	assert.match(pane, /data-i18n-value="prefJournalFolder"/, "a labelled row states the folder");
	assert.match(pane, /id="zotpop-journal-folder"[^>]*readonly="readonly"/, "the path is shown, not edited");
	assert.match(pane, /id="zotpop-journal-folder"[^>]*value="zotpop\/journals"/);
	assert.match(pane, /data-i18n="prefJournalFolderNote"/, "with one note under it");
	// No preference is bound to it: there is no such setting, and offering one
	// would imply the folder can be moved.
	const row = /<html:input id="zotpop-journal-folder"[^>]*>/.exec(pane)[0];
	assert.ok(!row.includes("preference="), "the row reports a location rather than storing one");

	for (const locale of ["en", "ko"]) {
		const note = I18N.STRINGS[locale].prefJournalFolderNote;
		assert.match(note, /jcr\.json/, `${locale} names the figures file`);
		assert.match(note, /journal-registry\.json/, `${locale} names the registry file`);
		const label = I18N.STRINGS[locale].prefJournalFolder;
		assert.match(label, locale === "en" ? /Zotero data directory/ : /Zotero 데이터 폴더/);
	}
	assert.match(I18N.STRINGS.en.prefJournalFolderNote, /never packaged with the plugin and never published/);
	assert.match(I18N.STRINGS.ko.prefJournalFolderNote, /배포본에 넣거나 공개하지 않습니다/);
});

test("nothing claims the plugin ships a Journal Impact Factor, or calls the OpenAlex figure one", () => {
	/* The figure the archive carries is a two-year mean citedness, which is not
	   a JIF: the JIF is the Clarivate figure a reader supplies themselves. */
	for (const locale of ["en", "ko"]) {
		const strings = I18N.STRINGS[locale];
		assert.ok(!/shipped with the plugin|플러그인에 내장/.test(strings.prefNoteIF),
			`${locale} no longer says the figures are packaged`);
		assert.ok(!/Impact Factor|JIF/.test(strings.prefJIF),
			`${locale} does not call the OpenAlex lookup a Journal Impact Factor`);
		assert.match(strings.prefJIF, locale === "en" ? /2-year mean citedness/ : /2년 평균 피인용도/);
		assert.match(strings.prefNoteIF, locale === "en" ? /2-year mean citedness/ : /2년 평균 피인용도/);
	}
});
