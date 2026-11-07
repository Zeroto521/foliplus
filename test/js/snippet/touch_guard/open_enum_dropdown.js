async () => {
    const api = window.map.foliplus && window.map.foliplus.LayerAPI;
    if (!api) return false;
    const ID = "__touch_probe__";
    const VALUES = ["a","b","c","d","e","f","g","h","i","j","k","l"];
    let filter;
    const model = () => ({
        dimensions: [{ kind: "enum", field: "kind", label: "Kind", multi: true,
            options: VALUES.map(v => ({ value: v, label: v.toUpperCase() })) }],
        filter, kept: VALUES.length, total: VALUES.length,
    });
    api.registerLayer({ id: ID, name: "Touch scroll", layer: L.layerGroup(),
        filterProvider: model, filterSetter: next => { filter = next; } });
    await new Promise(r => setTimeout(r, 30));
    const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${ID}"]`);
    if (!row) return false;
    row.querySelector(".foliplus-layer-more-btn")?.click();
    await new Promise(r => setTimeout(r, 30));
    const menuItem = row.querySelector('.foliplus-layer-more-menu [data-action="filter-layer"]');
    if (!menuItem) return false;
    menuItem.click();
    await new Promise(r => setTimeout(r, 40));
    const panel = row.querySelector(".foliplus-layer-filter-panel");
    const trigger = panel && panel.querySelector(".foliplus-filter-enum .foliplus-dropdown-trigger");
    if (!trigger) return false;
    if (trigger.getAttribute("aria-expanded") !== "true") { trigger.click(); await new Promise(r => setTimeout(r, 40)); }
    return true;
}
