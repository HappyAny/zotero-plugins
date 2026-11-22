// Historical negative control, not production code.
class HistoricalRuntime {
async refreshWindows() {
    // Anything worth repainting for is worth recomputing for.
    this.bumpState();
    for (const [win, state] of this.windows) {
      if (!win.closed && !state.refreshing) {
        state.refreshing = true;
        try {
          const view = win.ZoteroPane?.itemsView;
          if (view?.collectionTreeRow) await view.refreshAndMaintainSelection();
          state.workbench?.refreshReading?.();
        }
        finally { state.refreshing = false; }
      }
    }
  }
addWindow(win) {
    if (!this.active || this.stopping || this.windows.has(win)) return;
    const state = { nodes:[], listeners:[], signature:null,titleNodes:new Set(),titlePositions:new Map(),titleWeights:new Map() }; this.windows.set(win,state);
    const unload = () => {this.removeWindow(win).catch(error=>this.Z.logError(error));};
    win.addEventListener("unload", unload, { once: true });
    state.listeners.push([win, "unload", unload]);
    this.attachMotion(win,state);
    this.attachColumnFit(win,state);
    try{this.attachCells(win,state);}catch(error){this.Z.logError(error);}
    this.watchItemPane(win,state);
    state.readerCleanup=this.readerTools.attach(win);
    state.collectionCountCleanup=this.collectionCounts.attach(win);
    for(const tab of this.readerTools.tabs(win))if(tab.itemID)this.tabItems.set(tab.id,tab.itemID);
    state.workbench=this.Workbench.attach(win,{runtime:this,library:this.Library.create({Zotero:this.Z,runtime:this}),reader:this.readerTools,model:this.workspaceTools,assist:this.assist});
    const doc = win.document;
    state.menuNodes = [];
    this.buildMenus(win, state);
    const poll = async () => {
      if (!this.active || win.closed || state.polling) return;
      state.polling = true;
      try {
        const view=win.ZoteroPane?.itemsView;
        const rows=[...doc.querySelectorAll("#zotero-items-tree .row")];
        const records=rows.map(row=>view?.getRow(Number(row.id.match(/-row-(\d+)$/)?.[1]))?.ref).filter(item=>this.isRegular(item));
        /* Reading time and the last-read stamp change every second a paper is
           open; their cells are repainted in place (refreshReadingDisplays).
           Counted here, they rebuilt the whole list every five seconds, and the
           flush beside them rewrote the store as often. */
        const signature=JSON.stringify(records.map(item=>{const {seconds,lastRead,...rest}=this.state(item);return [this.identity(item),rest];}));
        if(state.signature!==null && signature!==state.signature) await view?.refreshAndMaintainSelection();
        state.signature=signature;this.enhanceTitles(win,state,records); if(this.dirty)this.scheduleFlush(30000);
        if(this.featureEnabled("citedCountColumn")&&this.pref("autoCitations",true)&&!this.citationJob&&!this.stopping) {
          // Without a key, OpenAlex list requests come out of a budget of about
          // ten a day shared with ZotPoP's searches; the background job waits
          // for a key rather than spending them before the user has searched once.
          if(this.openAlexKey())this.refreshCitations(records,{background:true}).catch(error=>this.Z.logError(error));
        }
      } catch(error){this.Z.logError(error);} finally{state.polling=false;}
    };
    state.timer=win.setInterval(poll,5000); poll();
    const quickFilter=event=>{if(!this.featureEnabled('itemTypeFilter')||!this.pref('quickTypeFilter',true)||event.button!==0||!event.target.closest?.('.cell-icon'))return;const row=event.target.closest('.row');if(!row)return;const item=win.ZoteroPane?.itemsView?.getRow(Number(row.id.match(/-row-(\d+)$/)?.[1]))?.ref;if(!this.isRegular(item)||!state.workbench)return;event.preventDefault();event.stopPropagation();state.workbench.state.type=this.Z.ItemTypes.getName(item.itemTypeID);state.workbench.show('explore').catch(e=>this.Z.logError(e));};
    const tree=doc.getElementById('zotero-items-tree');if(tree){tree.addEventListener('click',quickFilter,true);state.listeners.push([tree,'click',quickFilter,true]);}
    const css=this.pref('panelCSS','');if(css)try{this.setPanelCSS(css);}catch(error){this.Z.logError(error);}
  }
}
