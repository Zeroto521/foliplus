// Reads the role row's layout geometry: divider, count, icon, more columns.
// Returns a per-row snapshot so a browser test can assert the divider stops
// before the count column and does not overlap count/icon/more. Also reports
// any leftover section-divider (the pre-folder divider that must be gone).
() => {
  const rows = Array.from(document.querySelectorAll(".foliplus-layer-role"));
  return rows.map(row => {
    const rect = row.getBoundingClientRect();
    const pick = sel => {
      const el = row.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left - rect.left),
        right: Math.round(r.right - rect.left),
        width: Math.round(r.width),
      };
    };
    return {
      role: row.getAttribute("data-role"),
      divider: pick(".foliplus-role-divider"),
      count: pick(".foliplus-layer-count"),
      icon: pick(".foliplus-type-icon-col"),
      more: pick(".foliplus-layer-more-btn"),
      sectionDividerCount: row.querySelectorAll(".foliplus-section-divider").length,
    };
  });
};
