fixItemPaneRows(doc) {
    let fixed = 0;
    for (const row of doc.querySelectorAll('#zotero-item-pane .meta-row')) {
      const value = row.querySelector('editable-text[multiline], .value');
      if (!value) continue;
      const need = value.getBoundingClientRect?.().height || 0, have = row.getBoundingClientRect?.().height || 0;
      if (need > have + 1) { row.style.minHeight = Math.ceil(need) + 'px'; fixed++; }
      else if (row.style.minHeight && need + 1 < have) row.style.removeProperty('min-height');
    }
    return fixed;
  }