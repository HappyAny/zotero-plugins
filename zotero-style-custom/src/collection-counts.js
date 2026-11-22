/* Counts beside Zotero's own collection tree. No idle polling or library writes. */
var CustomStyleCollectionCounts = (() => {
  const CLASS = 'style-custom-collection-count';
  const TYPES = new Set(['library', 'group', 'feed', 'collection', 'search',
    'duplicates', 'unfiled', 'recentlyRead', 'retracted', 'publications', 'trash']);
  const MEMBERSHIP = new Set(['library', 'group', 'feed', 'collection']);
  const CSS = `.${CLASS}{margin-inline-start:auto;margin-inline-end:4px;padding:0 7px;
    min-width:18px;flex:0 0 auto;text-align:center;font-size:max(11px,.85em);
    line-height:1.5;border-radius:999px;font-variant-numeric:tabular-nums;
    color:inherit;background:color-mix(in srgb,currentColor 8%,transparent)}
    .primary:has(>.${CLASS})>.cell-text{min-width:0}`;

  function create({Zotero: Z, runtime}) {
    const windows = new Map(), cache = new Map(), prefObservers = [];
    let notifier = null;
    const enabled = () => runtime.featureEnabled('collectionItemCount');
    const log = error => Z.logError?.(error);
    const recursive = () => Z.Prefs?.get('recursiveCollections') === true;
    const paper = (item, deleted = false) => !!item?.isRegularItem?.()
      && (deleted || !item.deleted);
    const keyFor = row => TYPES.has(row?.type) && row.ref
      ? [row.type, row.ref.libraryID ?? row.ref._libraryID,
        row.ref.id ?? row.ref._id ?? row.id, row.type === 'collection' && recursive()].join(':')
      : null;

    async function count(row) {
      let items;
      if (['library', 'group', 'feed'].includes(row.type)) {
        items = await Z.Items.getAll(row.ref.libraryID ?? row.ref._libraryID, true, false);
      } else if (row.type === 'collection') {
        if (recursive()) {
          const ids = [...new Set(row.ref.getDescendents(false, 'item', false).map(item => item.id))];
          items = ids.length ? await Z.Items.getAsync(ids) : [];
        } else items = row.ref.getChildItems(false, false);
      } else if (typeof row.getItems === 'function') {
        // Ignore a selected row's quicksearch and tag filter when counting its folder.
        items = await row.getItems({unfiltered: true});
      } else if (row.type === 'search' && typeof row.ref.search === 'function') {
        const ids = await row.ref.search();
        items = ids.length ? await Z.Items.getAsync(ids) : [];
      } else return null;
      return new Set((items || []).filter(item => paper(item, row.type === 'trash'))
        .map(item => item.id)).size;
    }

    function entryFor(row, key) {
      let entry = cache.get(key);
      if (entry) { cache.delete(key); cache.set(key, entry); return entry; }
      entry = {type: row.type, value: undefined};
      cache.set(key, entry);
      entry.promise = Promise.resolve().then(() => count(row)).then(value => {
        entry.value = value;
        return value;
      }).catch(error => { entry.value = null; log(error); return null; });
      while (cache.size > 512) cache.delete(cache.keys().next().value);
      return entry;
    }

    function repaint(state, rendererChanged = false) {
      if (!state.active || state.win.closed || !state.view) return;
      const invalidate = () => state.view.tree?.invalidate?.();
      if (!rendererChanged) { invalidate(); return; }
      // CollectionTree passes its renderer to a React child. Refresh that prop too.
      const updateTree = () => {
        if (state.view.tree?.forceUpdate) state.view.tree.forceUpdate(invalidate);
        else invalidate();
      };
      if (state.view.forceUpdate) state.view.forceUpdate(updateTree);
      else updateTree();
    }

    function schedule(state) {
      if (!state.active || state.timer != null) return;
      state.timer = state.win.setTimeout(() => {
        state.timer = null;
        try { repaint(state); } catch (error) { log(error); }
      }, 100);
    }

    function invalidate(metadataOnly = false) {
      for (const [key, entry] of cache) {
        if (!metadataOnly || !MEMBERSHIP.has(entry.type)) cache.delete(key);
      }
      for (const state of windows.values()) schedule(state);
    }

    function startObservers() {
      if (notifier == null && Z.Notifier?.registerObserver) {
        notifier = Z.Notifier.registerObserver({notify(event, type) {
          if (event === 'select' || event === 'redraw') return;
          invalidate(type === 'item' && event === 'modify');
        }}, ['item', 'collection', 'collection-item', 'search', 'trash', 'group', 'feed'],
        'style-custom-collection-counts');
      }
      if (!prefObservers.length && Z.Prefs?.registerObserver) {
        prefObservers.push(Z.Prefs.registerObserver('recursiveCollections', () => invalidate()));
        prefObservers.push(Z.Prefs.registerObserver('extensions.style-custom.feature.collectionItemCount',
          () => invalidate(), true));
      }
    }

    function foreignCount(primary) {
      return [...primary.children].some(child => {
        if (child.classList.contains(CLASS)
            || child.matches('.cell-text,.cell-icon,.twisty,input,[class*="spacer"]')) return false;
        return /collection[-_]item[-_]count/i.test(child.className)
          || /^\(?\d[\d,.\s]*\)?$/.test(child.textContent.trim());
      });
    }

    function paint(state, div, token, key, entry, value) {
      if (!state.active || !enabled() || state.tokens.get(div) !== token
          || cache.get(key) !== entry || keyFor(state.view.getRow(token.index)) !== key
          || !Number.isInteger(value)) return;
      const primary = div.querySelector('.primary');
      if (!primary || div.classList.contains('editing') || foreignCount(primary)) return;
      let badge = primary.querySelector('.' + CLASS);
      if (!badge) {
        badge = state.win.document.createElement('span');
        badge.className = CLASS;
        primary.appendChild(badge);
      }
      badge.textContent = String(value);
    }

    async function install(state, view) {
      await view.waitForLoad?.();
      if (!state.active || state.win.closed) return;
      state.view = view;
      state.original = view.renderItem;
      state.wrapper = function(index, ...args) {
        const div = state.original.call(this, index, ...args);
        if (!state.active || !div) return div;
        for (const badge of div.querySelectorAll('.' + CLASS)) badge.remove();
        const token = {index};
        state.tokens.set(div, token);
        const row = view.getRow(index), key = keyFor(row);
        if (!enabled() || !key || div.classList.contains('editing')) return div;
        const entry = entryFor(row, key);
        if (entry.value !== undefined) paint(state, div, token, key, entry, entry.value);
        else entry.promise.then(value => {
          try { paint(state, div, token, key, entry, value); } catch (error) { log(error); }
        });
        return div;
      };
      view.renderItem = state.wrapper;
      repaint(state, true);
    }

    function attach(win) {
      if (!win.ZoteroPane || windows.has(win)) return () => {};
      const state = {win, active: true, timer: null, readyTimer: null, tokens: new WeakMap()};
      windows.set(win, state);
      const style = win.document.createElement('style');
      style.textContent = CSS;
      (win.document.head || win.document.documentElement).appendChild(style);
      state.style = style;
      startObservers();
      let attempts = 0;
      const ready = () => {
        state.readyTimer = null;
        if (!state.active || win.closed) return;
        const view = win.ZoteroPane?.collectionsView;
        if (typeof view?.renderItem === 'function') {
          install(state, view).catch(log);
        } else if (++attempts < 40) state.readyTimer = win.setTimeout(ready, 250);
      };
      ready();
      return () => detach(state);
    }

    async function detach(state) {
      if (!state.active) return;
      state.active = false;
      windows.delete(state.win);
      if (state.timer != null) state.win.clearTimeout(state.timer);
      if (state.readyTimer != null) state.win.clearTimeout(state.readyTimer);
      if (state.view && state.view.renderItem === state.wrapper) state.view.renderItem = state.original;
      for (const badge of state.win.document.querySelectorAll('.' + CLASS)) badge.remove();
      state.style.remove();
      // Use the original renderer immediately after disable, without changing selection.
      if (state.view && !state.win.closed) {
        state.active = true;
        try { repaint(state, true); } finally { state.active = false; }
      }
      if (!windows.size) {
        cache.clear();
        const tasks = [];
        if (notifier != null) {
          const id = notifier; notifier = null;
          tasks.push(Z.Notifier.unregisterObserver(id));
        }
        for (const id of prefObservers.splice(0)) tasks.push(Z.Prefs.unregisterObserver(id));
        await Promise.all(tasks);
      }
    }

    return {attach, applyPreferences: () => invalidate(),
      async stop() { await Promise.all([...windows.values()].map(detach)); }};
  }
  return {create};
})();
if (typeof module !== 'undefined') module.exports = CustomStyleCollectionCounts;
