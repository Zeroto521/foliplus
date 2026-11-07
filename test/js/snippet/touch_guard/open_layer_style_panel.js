() => {
    const row = document.querySelector(".foliplus-layer-item[data-layer-type=overlay]");
    if (!row) return false;
    row.querySelector(".foliplus-layer-more-btn").click();
    const menu = row.querySelector(".foliplus-layer-more-menu.open");
    if (!menu) return false;
    const item = menu.querySelector('button[data-action="style-layer"]');
    if (!item) return false;
    item.click();
    return !!row.querySelector(".foliplus-layer-style-panel");
}
