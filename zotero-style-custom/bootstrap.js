/* global Zotero, Services, IOUtils, PathUtils */
"use strict";
var customStyle = null;
// Where a reader puts journal figures their institution licenses to them. Nothing in
// this folder is ever packaged into the archive or published.
const JOURNAL_OVERLAY_DIR = "style-custom-journals";
// Bump only when the shipped open journal catalog/registry data schema changes,
// so code-only plugin patch updates keep reusing the ~100 KB hot subset cache.
const JOURNAL_SUBSET_CATALOG_REV = "open-v1";
var readerWindowObserver = null;
function install() {}
function uninstall() {}
async function startup({ id, version, rootURI }) {
  try {
    await Zotero.initializationPromise;
    const loadedScripts = new Set();
    const loadScript = name => {
      if (loadedScripts.has(name)) return true;
      Services.scriptloader.loadSubScript(rootURI + "src/" + name + ".js", globalThis);
      loadedScripts.add(name);
      return true;
    };
    // Core modules required on the startup path. Heavy optional panels and tools
    // (workbench 801KB, reader-assist + helpers 504KB, selfcheck 206KB, paper-graph 70KB,
    // library 58KB, reading-path 51KB, jcr-browser 36KB, author-portrait 29KB, assist 24KB,
    // library-facts + patents ~30KB = ~1.82 MB) load on first use via loadScript().
    for (const name of ["settings-schema", "data", "journals", "citations", "citation-formats", "supplementary", "discover", "paper-signals", "attention", "legacy-reading", "journal-metrics", "i18n", "strings", "attachment-kinds", "item-kinds", "journal-identity", "jcr-categories", "affiliations", "failures", "brand-icons", "workspace", "reader-tools", "collection-counts", "marquee", "item-cells", "reading", "updater", "runtime"]) {
      loadScript(name);
    }
    const path = PathUtils.join(Zotero.DataDirectory.dir, "style-custom.json");
    const hotPath = PathUtils.join(Zotero.DataDirectory.dir, "style-custom-reading.json");
    const coldPath = PathUtils.join(Zotero.DataDirectory.dir, "style-custom-workbench.json");
    let hadHotReadingOnRead = false;
    let hadMonolithicColdOnRead = false;
    let coldExistsOnRead = false;
    let legacy = {};
    try {
      const oldPath = PathUtils.join(Zotero.DataDirectory.dir, "zoterostyle.json");
      if (await IOUtils.exists(oldPath) && (await IOUtils.stat(oldPath)).size <= 50 * 1024 * 1024) legacy = JSON.parse(await IOUtils.readUTF8(oldPath));
    } catch (error) { Zotero.logError(error); }
    // Journal figures arrive in two layers. The plugin ships only what it may pass on:
    // OpenAlex, which is CC0. Licensed figures -- a Journal Citation Reports export the
    // reader's institution entitles them to -- are never packaged and never published;
    // they are read from this folder in the Zotero data directory, and where one exists
    // it wins, so a subscriber keeps seeing their own numbers.
    const journalDir = PathUtils.join(Zotero.DataDirectory.dir, JOURNAL_OVERLAY_DIR);
    const journalLayers = {};
    const localJournalData = async name => {
      try {
        const file = PathUtils.join(journalDir, name);
        if (!await IOUtils.exists(file)) return null;
        if ((await IOUtils.stat(file)).size > 200 * 1024 * 1024) throw new Error(name + " is too large to read");
        return JSON.parse(await IOUtils.readUTF8(file));
      } catch (error) { Zotero.logError(error); return null; }
    };
    const journalData = async (localName, shippedName = localName) => {
      const local = await localJournalData(localName);
      if (local) { journalLayers[localName] = "local"; return local; }
      // Zotero 10's HTTP.request throws on jar: URLs (nsIURI.username); a channel reads the packaged file.
      const shipped = JSON.parse(await Zotero.File.getResourceAsync(rootURI + "data/" + shippedName));
      journalLayers[localName] = "shipped";
      return shipped;
    };
    const subsetPath = PathUtils.join(Zotero.DataDirectory.dir, "style-custom-journal-subset.json");
    const overlaySig = async name => {
      try {
        const file = PathUtils.join(journalDir, name);
        if (!await IOUtils.exists(file)) return "shipped";
        const st = await IOUtils.stat(file);
        return `local:${st.size || 0}:${st.lastModified || 0}`;
      } catch (_) { return "shipped"; }
    };
    const subsetSignature = [JOURNAL_SUBSET_CATALOG_REV, await overlaySig("if-catalog.json"), await overlaySig("journal-registry.json")].join("|");
    let subsetData = null;
    try {
      if (await IOUtils.exists(subsetPath) && (await IOUtils.stat(subsetPath)).size <= 16 * 1024 * 1024) {
        const parsed = JSON.parse(await IOUtils.readUTF8(subsetPath));
        if (parsed && parsed.schema === 1 && parsed.signature === subsetSignature
            && Array.isArray(parsed.ifRecords) && Array.isArray(parsed.registryRows)) {
          subsetData = parsed;
        }
      }
    } catch (error) { Zotero.debug("Style Custom: journal subset cache ignored: " + (error && error.message)); }
    let catalog = [];
    let fullIfCount = 0;
    let fullRegistryCount = 0;
    if (subsetData) {
      catalog = subsetData.ifRecords;
      fullIfCount = Number(subsetData.fullIfCount) || catalog.length;
      fullRegistryCount = Number(subsetData.fullRegistryCount) || subsetData.registryRows.length;
      journalLayers["if-catalog.json"] = subsetData.layers?.["if-catalog.json"] || "shipped";
      journalLayers["journal-registry.json"] = subsetData.layers?.["journal-registry.json"] || "shipped";
      try {
        if (globalThis.CustomStyleJournalIdentity) {
          globalThis.CustomStyleJournalIdentity.loadRegistry(subsetData.registryRows, { lazyKeys: true });
        }
      } catch (error) { Zotero.debug("Style Custom: journal registry subset not loaded: " + (error && error.message)); }
    } else {
      catalog = await journalData("if-catalog.json");
      fullIfCount = Array.isArray(catalog) ? catalog.length : 0;
      // The registry combines the metric with OpenAlex subject paths. Optional for older
      // builds; missing records stay unknown rather than guessed at.
      try {
        const registry = await journalData("journal-registry.json");
        if (registry && globalThis.CustomStyleJournalIdentity) {
          fullRegistryCount = globalThis.CustomStyleJournalIdentity.loadRegistry(registry, { lazyKeys: true });
        }
      } catch (error) { Zotero.debug("Style Custom: journal registry not loaded: " + (error && error.message)); }
    }
    let jcrCatalog = null, jcrCatalogError = null, jcrCatalogLoaded = false, jcrCatalogPromise = null;
    const loadJcrCatalog = async () => {
      if (jcrCatalogLoaded) return jcrCatalog;
      if (jcrCatalogPromise) return jcrCatalogPromise;
      jcrCatalogPromise = (async () => {
        try {
          const raw = await journalData("jcr-categories.json", "journal-catalog.json");
          jcrCatalog = globalThis.CustomStyleJCRCategories.create(raw, { copyPayload: false, freezeResult: false });
          jcrCatalogError = null;
        } catch (error) {
          jcrCatalog = null;
          jcrCatalogError = String(error && error.message || error);
          Zotero.debug("Style Custom: journal category catalog not loaded: " + jcrCatalogError);
        } finally {
          jcrCatalogLoaded = true;
          jcrCatalogPromise = null;
          if (customStyle) {
            customStyle.jcrCatalog = jcrCatalog;
            customStyle.jcrCatalogError = jcrCatalogError;
          }
        }
        return jcrCatalog;
      })();
      return jcrCatalogPromise;
    };
    // A local licensed JCR overlay powers item-list IF tooltips (Q1/rank) right away.
    // The shipped 28.7 MB OpenAlex category catalog is only used inside the Workbench
    // Journals browser, so it loads lazily on first open to save ~100 MB & >1s at startup.
    let hasLocalJcr = false;
    try { hasLocalJcr = await IOUtils.exists(PathUtils.join(journalDir, "jcr-categories.json")); } catch (_) {}
    if (hasLocalJcr) {
      await loadJcrCatalog();
    } else {
      journalLayers["jcr-categories.json"] = "shipped";
    }
    const mergeHotReading = (base, hot) => {
      if (!hot || hot.schema !== 1 || !hot.items || typeof hot.items !== "object" || Array.isArray(hot.items)) return false;
      let merged = false;
      base.items ||= {};
      for (const [id, patch] of Object.entries(hot.items)) {
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;
        const target = base.items[id] ||= {};
        const baseSec = Number(target.seconds) || 0, hotSec = Number(patch.seconds) || 0;
        if (hotSec >= baseSec && Number.isFinite(patch.seconds)) target.seconds = patch.seconds;
        if (typeof patch.unreadOverride === "boolean") target.unreadOverride = patch.unreadOverride;
        if (typeof patch.lastRead === "string" && (!target.lastRead || patch.lastRead >= target.lastRead)) target.lastRead = patch.lastRead;
        if (patch.readingAttachments && typeof patch.readingAttachments === "object" && !Array.isArray(patch.readingAttachments)) {
          target.readingAttachments = { ...(target.readingAttachments || {}), ...patch.readingAttachments };
        }
        if (Number.isInteger(patch.readingAttachmentID) && patch.readingAttachmentID > 0) target.readingAttachmentID = patch.readingAttachmentID;
        merged = true;
      }
      return merged;
    };
    customStyle = new globalThis.CustomStyleRuntime({ Zotero, catalog, ownCatalog: true, io: IOUtils, paths: PathUtils,
      model: globalThis.CustomStyleData, marquee: globalThis.CustomStyleMarquee,
      reading: globalThis.CustomStyleReading, legacy, loadScript,
      storage: {
        async read() {
          let base = { schema: 1, items: {} };
          if (await IOUtils.exists(path)) {
            if ((await IOUtils.stat(path)).size > 50 * 1024 * 1024) throw new Error("Style Custom cache is too large");
            base = JSON.parse(await IOUtils.readUTF8(path));
          }
          const coldKeys = globalThis.CustomStyleRuntime?.COLD_CACHE_KEYS || [];
          hadMonolithicColdOnRead = coldKeys.some(k => Object.prototype.hasOwnProperty.call(base, k));
          coldExistsOnRead = false;
          try { coldExistsOnRead = await IOUtils.exists(coldPath); } catch (_) { coldExistsOnRead = false; }
          // Crash recovery: if a prior migration wrote coldPath before trimming path, coldPath is strictly newer.
          if (hadMonolithicColdOnRead && coldExistsOnRead) {
            try {
              if ((await IOUtils.stat(coldPath)).size <= 50 * 1024 * 1024) {
                const cold = JSON.parse(await IOUtils.readUTF8(coldPath));
                if (cold && typeof cold === "object") {
                  for (const k of coldKeys) {
                    if (Object.prototype.hasOwnProperty.call(cold, k)) base[k] = cold[k];
                  }
                }
              }
            } catch (error) { Zotero.logError(error); }
          }
          hadHotReadingOnRead = false;
          try {
            if (await IOUtils.exists(hotPath) && (await IOUtils.stat(hotPath)).size <= 16 * 1024 * 1024) {
              const hot = JSON.parse(await IOUtils.readUTF8(hotPath));
              hadHotReadingOnRead = mergeHotReading(base, hot);
            }
          } catch (error) { Zotero.logError(error); }
          return base;
        },
        hadHot() { return hadHotReadingOnRead; },
        hasColdFile() { return coldExistsOnRead; },
        hadMonolithicCold() { return hadMonolithicColdOnRead; },
        async readCold() {
          try {
            if (await IOUtils.exists(coldPath)) {
              if ((await IOUtils.stat(coldPath)).size > 50 * 1024 * 1024) throw new Error("Style Custom workbench cache is too large");
              const parsed = JSON.parse(await IOUtils.readUTF8(coldPath));
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
            }
          } catch (error) { Zotero.logError(error); }
          return { schema: 1 };
        },
        async writeCold(encoded) {
          if (encoded.length > 50 * 1024 * 1024) throw new Error("Style Custom workbench cache is too large.");
          await IOUtils.writeUTF8(coldPath, encoded, { tmpPath: coldPath + ".tmp" });
          coldExistsOnRead = true;
          hadMonolithicColdOnRead = false;
        },
        async writeHot(encoded) {
          if(encoded.length>16*1024*1024)throw new Error('Style Custom reading overlay is too large.');
          await IOUtils.writeUTF8(hotPath, encoded, { tmpPath: hotPath + ".tmp" });
        },
        async clearHot() {
          hadHotReadingOnRead = false;
          try { await IOUtils.remove?.(hotPath, { ignoreAbsent: true }); } catch (_) {}
        },
        async writeRaw(encoded) {
          if(encoded.length>16*1024*1024)throw new Error('Style Custom storage is too large. Remove boards and drafts you no longer use.');
          await IOUtils.writeUTF8(path, encoded, { tmpPath: path + ".tmp" });
        },
        async write(value) {
          const encoded=JSON.stringify(value);
          return this.writeRaw(encoded);
        }
      }
    });
    customStyle.jcrCatalog = jcrCatalog;
    customStyle.jcrCatalogError = jcrCatalogError;
    customStyle.ensureJcrCatalog = loadJcrCatalog;
    customStyle.journalLayers = journalLayers;
    customStyle.journalDir = journalDir;
    customStyle.configureJournalSubset({
      active: !!subsetData,
      signature: subsetSignature,
      subsetPath,
      fullIfCount,
      fullRegistryCount,
      layers: { "if-catalog.json": journalLayers["if-catalog.json"] || "shipped", "journal-registry.json": journalLayers["journal-registry.json"] || "shipped" },
      misses: subsetData?.misses || [],
      subsetRegistryRows: subsetData?.registryRows || null,
      loadFullIf: () => journalData("if-catalog.json"),
      loadFullRegistry: () => journalData("journal-registry.json")
    });
    await customStyle.start({ id, version, rootURI });
    if (!subsetData && typeof Zotero.Items?.getAll === "function" && typeof Zotero.Libraries?.getAll === "function") {
      customStyle.scheduleInitialJournalSubsetBuild(2500);
    }
    Zotero.StyleCustom = customStyle;
    for (const window of Zotero.getMainWindows()) customStyle.addWindow(window);
    for (const reader of Zotero.Reader._readers || []) {
      if (reader._window?.location?.href === "chrome://zotero/content/reader.xhtml") customStyle.addWindow(reader._window);
    }
    readerWindowObserver = { observe(subject) {
      const win = subject;
      win.addEventListener("load", () => {
        if (win.location?.href === "chrome://zotero/content/reader.xhtml") customStyle?.addWindow(win);
      }, { once: true });
    } };
    Services.obs.addObserver(readerWindowObserver, "domwindowopened");
    // One-time migration of already verified counts: no code window or repeat
    // network sweep is needed to add source/date metadata to existing papers.
    const runtime=customStyle;
    if(runtime.pref("metadataCitations",true) && !runtime.cache.citationMetadataMigrated
        && Object.values(runtime.cache.items).some(entry=>entry.citationLookup?.status==="ok")) {
      runtime.syncLibraryCitations(Zotero.Libraries.userLibraryID,{lookup:false}).then(async report=>{
        if(!report.cancelled && !report.errors) {runtime.cache.citationMetadataMigrated=true;runtime.dirty=true;await runtime.flush();}
      }).catch(error=>Zotero.logError(error));
    }
    // A self-check the developer can ask for from outside: set the pref while
    // Zotero is closed, start it, and read the report out of the data folder.
    // The failures worth catching -- SVG innerHTML, a dialog whose rows overlap,
    // a column that throws while painting -- only exist in the real runtime.
    if (Zotero.Prefs.get("extensions.style-custom.selfCheck", true)) {
      loadScript("selfcheck");
      loadScript("selfcheck-reader");
      // Read the flags before clearing them: clearing first and reading inside
      // the timer meant repair and fill were always false by the time they were
      // asked for, and the run silently did nothing but the read-only checks.
      const options = {
        network: Zotero.Prefs.get("extensions.style-custom.selfCheckNetwork", true) !== false,
        repair: Zotero.Prefs.get("extensions.style-custom.selfCheckRepair", true) === true,
        fill: Zotero.Prefs.get("extensions.style-custom.selfCheckFill", true) === true,
        shots: Zotero.Prefs.get("extensions.style-custom.selfCheckShots", true) === true,
        seed: String(Zotero.Prefs.get("extensions.style-custom.selfCheckDemoSeed", true) || ""),
        // Opens one PDF in a background reader tab, measures the reader panel on it and closes the tab
        // (style-custom-reader-check.json). Off unless asked for: the default check never opens a reader.
        reader: Zotero.Prefs.get("extensions.style-custom.selfCheckReader", true) === true,
        // With the reader check only: one summary, one question and one stopped question through the AI account
        // bridge, measured end to end (style-custom-reader-check.json, "ai").
        readerAI: Zotero.Prefs.get("extensions.style-custom.selfCheckReader", true) === true
          && Zotero.Prefs.get("extensions.style-custom.selfCheckReaderAI", true) === true
      };
      for (const flag of ["selfCheck", "selfCheckRepair", "selfCheckFill", "selfCheckShots", "selfCheckReader", "selfCheckReaderAI"]) Zotero.Prefs.set("extensions.style-custom." + flag, false, true);
      Zotero.Prefs.set("extensions.style-custom.selfCheckDemoSeed", "", true);
      const reportPath = PathUtils.join(Zotero.DataDirectory.dir, "style-custom-selfcheck.json");
      setTimeout(() => {
        globalThis.CustomStyleSelfCheck
          .run(Zotero, customStyle, options)
          .then(report => IOUtils.writeUTF8(reportPath, JSON.stringify(report, null, 1)))
          .catch(error => IOUtils.writeUTF8(reportPath,
            JSON.stringify({fatal: String(error && error.stack || error)}, null, 1)));
      }, 6000);
    }
  } catch (error) {
    await shutdown();
    Zotero.logError(error);
    throw error;
  }
}
function onMainWindowLoad({ window }) { customStyle?.addWindow(window); }
function onMainWindowUnload({ window }) { customStyle?.removeWindow(window).catch(error=>Zotero.logError(error)); }
// Zotero calls this with the reason. On APP_SHUTDOWN the item tree is about to
// write its column layout to disk, and a column unregistered here is dropped
// from that file -- which is how every width and order the user set was lost at
// each quit. The columns are left registered on quit; Zotero removes a plugin's
// columns itself on disable and uninstall.
async function shutdown(data, reason) {
  if (readerWindowObserver) { Services.obs.removeObserver(readerWindowObserver, "domwindowopened"); readerWindowObserver = null; }
  const runtime = customStyle;
  customStyle = null;
  if (Zotero.StyleCustom === runtime) delete Zotero.StyleCustom;
  await runtime?.stop({ keepColumns: reason === 'APP_SHUTDOWN' || reason === 2 });
}
