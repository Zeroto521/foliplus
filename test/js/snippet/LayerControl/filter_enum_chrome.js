() => {
  const panel = document.querySelector(".foliplus-layer-filter-panel");
  const trigger =
    panel && panel.querySelector(".foliplus-filter-enum .foliplus-dropdown-trigger");
  trigger && trigger.click();
  const list = document.querySelector(".foliplus-dropdown-list");
  const options = Array.from(document.querySelectorAll(".foliplus-dropdown-option"));
  // The data-* identity contract: the field row is reachable by
  // [data-filter-field], the value row by [data-filter-value="enum"], and a
  // class-only query must NOT be the unique path (it matches both rows).
  const fieldRows = panel
    ? Array.from(panel.querySelectorAll("[data-filter-field]"))
    : [];
  const valueRows = panel
    ? Array.from(panel.querySelectorAll("[data-filter-value]"))
    : [];
  const classMatches = panel
    ? Array.from(panel.querySelectorAll(".foliplus-filter-field"))
    : [];
  return {
    panelSelects: panel ? panel.querySelectorAll("select").length : null,
    pageNativeMultiple: document.querySelectorAll("select[multiple]").length,
    triggerClasses: trigger ? trigger.className : null,
    haspopup: trigger ? trigger.getAttribute("aria-haspopup") : null,
    formSelectChrome: Boolean(
      trigger && trigger.classList.contains("foliplus-form-select"),
    ),
    listRole: list ? list.getAttribute("role") : null,
    listMultiselectable: list ? list.getAttribute("aria-multiselectable") : null,
    listInsidePanel: Boolean(list && panel && panel.contains(list)),
    optionRoles: options.map(el => el.getAttribute("role")),
    optionSelected: options.map(el => el.getAttribute("aria-selected")),
    // data-* identity facts
    fieldRowCount: fieldRows.length,
    fieldRowIdentity: fieldRows.map(el => el.getAttribute("data-filter-field")),
    valueRowCount: valueRows.length,
    valueRowIdentities: valueRows.map(el => el.getAttribute("data-filter-value")),
    classMatchCount: classMatches.length,
  };
};
