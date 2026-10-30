() => {
                  const panel = document.querySelector(".foliplus-layer-filter-panel");
                  const trigger =
                    panel &&
                    panel.querySelector(".foliplus-filter-enum .foliplus-dropdown-trigger");
                  trigger && trigger.click();
                  const list = document.querySelector(".foliplus-dropdown-list");
                  const options = Array.from(
                    document.querySelectorAll(".foliplus-dropdown-option"),
                  );
                  return {
                    panelSelects: panel ? panel.querySelectorAll("select").length : null,
                    pageNativeMultiple: document.querySelectorAll("select[multiple]").length,
                    triggerClasses: trigger ? trigger.className : null,
                    haspopup: trigger ? trigger.getAttribute("aria-haspopup") : null,
                    formSelectChrome: Boolean(
                      trigger && trigger.classList.contains("foliplus-form-select"),
                    ),
                    listRole: list ? list.getAttribute("role") : null,
                    listMultiselectable: list
                      ? list.getAttribute("aria-multiselectable")
                      : null,
                    listInsidePanel: Boolean(list && panel && panel.contains(list)),
                    optionRoles: options.map(el => el.getAttribute("role")),
                    optionSelected: options.map(el =>
                      el.getAttribute("aria-selected"),
                    ),
                  };
                }
