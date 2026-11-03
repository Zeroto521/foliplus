// test/js/common/listbox.contract.test.ts
// The contract matrix, run against every self-built dropdown surface.
//
// §6 of .foliplus/zeta/dropdown-consolidation-design.md: one shared contract so
// a bug fix lands in exactly one place. The historical builders each had their
// own near-parallel test file; this matrix is the shared layer.
//
// Fixtures:
//   1. bridged single   — createDropdown({ nativeSelect }) (Heatmap agg / rampForm field)
//   2. standalone multi — createDropdown({ items, multiple:true }) (filter enum)
//   3. picker inline    — createSchemePicker({ portal:false })
//   4. picker portal    — createSchemePicker({ portal:true })
import { afterEach } from "vitest";
import { buildFieldRow } from "#core/rampForm.js";
import { type Dropdown, createDropdown } from "#common/dropdown.js";
import { createSchemePicker } from "#common/schemePicker.js";
import { type ContractFixture, describeListboxContract } from "./listboxContract.js";

// ── Shared fixtures ────────────────────────────────────────────────────

const cleanupAll: (() => void)[] = [];
afterEach(() => {
  while (cleanupAll.length > 0) cleanupAll.pop()?.();
  document.body.innerHTML = "";
});

const ITEMS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bee" },
  { value: "c", label: "Cee" },
  { value: "d", label: "De" },
  { value: "e", label: "Ef" },
  { value: "f", label: "Ff" },
  { value: "g", label: "Gg" },
  { value: "h", label: "Hh" },
  { value: "i", label: "Ii" },
  { value: "j", label: "Jj" },
];

// ── 1. bridged single (Heatmap aggregation / rampForm field) ───────────

const bridgedFixture: ContractFixture = {
  name: "contract: bridged single select",
  create() {
    const cell = document.createElement("div");
    cell.className = "foliplus-form-control";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Pick a thing");
    for (const item of ITEMS) {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      if (item.value === "c") opt.disabled = true;
      select.appendChild(opt);
    }
    select.value = "a";
    cell.appendChild(select);
    document.body.appendChild(cell);

    const dropdown: Dropdown = createDropdown({ nativeSelect: select });
    cleanupAll.push(() => dropdown.destroy());

    const list = () => dropdown.getList();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-value") ?? "",
        label: el.textContent ?? "",
        disabled: el.hasAttribute("disabled"),
      }));

    return {
      surface: {
        trigger: () => dropdown.trigger,
        rows,
        list,
        isOpen: () => dropdown.isOpen(),
        open: () => dropdown.open(),
        close: o => dropdown.close(o),
        destroy: () => dropdown.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          dropdown.trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: false,
        ownsDismiss: true,
        value: () => dropdown.getValue(),
        expanded: () => dropdown.trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => {},
    };
  },
};

// ── 2. standalone multi (filter enum) ──────────────────────────────────

const multiFixture: ContractFixture = {
  name: "contract: standalone multi select",
  create() {
    const dropdown: Dropdown = createDropdown({
      items: ITEMS.map(({ value, label }) => ({ value, label })),
      multiple: true,
      values: ["a"],
    });
    cleanupAll.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);

    const list = () => dropdown.getList();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-value") ?? "",
        label: el.textContent ?? "",
        disabled: el.hasAttribute("disabled"),
      }));

    return {
      surface: {
        trigger: () => dropdown.trigger,
        rows,
        list,
        isOpen: () => dropdown.isOpen(),
        open: () => dropdown.open(),
        close: o => dropdown.close(o),
        destroy: () => dropdown.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          dropdown.trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: true,
        ownsDismiss: true,
        value: () => dropdown.getValues().join(","),
        expanded: () => dropdown.trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => {},
    };
  },
};

// ── 3. picker inline ───────────────────────────────────────────────────

const pickerInlineFixture: ContractFixture = {
  name: "contract: scheme picker inline",
  create() {
    const cell = document.createElement("div");
    cell.className = "foliplus-form-control";
    const trigger = document.createElement("div");
    trigger.className = "foliplus-heatmap-scheme-bar";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("tabindex", "0");
    const inner = document.createElement("div");
    inner.setAttribute("data-scheme-bar-inner", "");
    trigger.appendChild(inner);
    cell.appendChild(trigger);
    document.body.appendChild(cell);

    let current = "Reds";
    const picker = createSchemePicker({
      trigger,
      schemes: ITEMS.map(i => i.value),
      value: "a",
      numClasses: 6,
      portal: false,
      colorScale: () => ["#f00", "#0f0", "#00f"],
      onChange: name => {
        current = name;
      },
      label: "Color scheme",
    });
    cleanupAll.push(() => picker.destroy());

    const list = () => picker.getDropdown();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-scheme-name") ?? "",
        label: el.querySelector("div")?.textContent ?? "",
        disabled: el.getAttribute("aria-disabled") === "true",
      }));

    return {
      surface: {
        trigger: () => trigger,
        rows,
        list,
        isOpen: () => picker.getDropdown() !== null,
        open: () => picker.toggle(),
        close: o => picker.close(o),
        destroy: () => picker.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: false,
        ownsDismiss: false,
        value: () => current,
        expanded: () => trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => {},
    };
  },
};

// ── 4. picker portal ───────────────────────────────────────────────────

const pickerPortalFixture: ContractFixture = {
  name: "contract: scheme picker portal",
  create() {
    const cell = document.createElement("div");
    cell.className = "foliplus-form-control";
    const trigger = document.createElement("div");
    trigger.className = "foliplus-heatmap-scheme-bar";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("tabindex", "0");
    const inner = document.createElement("div");
    inner.setAttribute("data-scheme-bar-inner", "");
    trigger.appendChild(inner);
    cell.appendChild(trigger);
    document.body.appendChild(cell);

    let current = "a";
    const picker = createSchemePicker({
      trigger,
      schemes: ITEMS.map(i => i.value),
      value: "a",
      numClasses: 6,
      portal: true,
      colorScale: () => ["#f00", "#0f0", "#00f"],
      onChange: name => {
        current = name;
      },
      label: "Color scheme",
    });
    cleanupAll.push(() => picker.destroy());

    const list = () => picker.getDropdown();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-scheme-name") ?? "",
        label: el.querySelector("div")?.textContent ?? "",
        disabled: el.getAttribute("aria-disabled") === "true",
      }));

    return {
      surface: {
        trigger: () => trigger,
        rows,
        list,
        isOpen: () => picker.getDropdown() !== null,
        open: () => picker.toggle(),
        close: o => picker.close(o),
        destroy: () => picker.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: false,
        ownsDismiss: false,
        value: () => current,
        expanded: () => trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => {},
    };
  },
};

// ── 5. rampForm field (LayerControl value-based fill) ──────────────────

const rampFormFixture: ContractFixture = {
  name: "contract: rampForm field row",
  create() {
    const { dropdown, select } = buildFieldRow({
      label: "Field",
      ariaLabel: "Field",
      fields: ITEMS.map(i => i.value),
      value: "a",
    });
    cleanupAll.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);

    const list = () => dropdown.getList();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-value") ?? "",
        label: el.textContent ?? "",
        disabled: el.hasAttribute("disabled"),
      }));

    return {
      surface: {
        trigger: () => dropdown.trigger,
        rows,
        list,
        isOpen: () => dropdown.isOpen(),
        open: () => dropdown.open(),
        close: o => dropdown.close(o),
        destroy: () => dropdown.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          dropdown.trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: false,
        ownsDismiss: true,
        value: () => select.value,
        expanded: () => dropdown.trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => {},
    };
  },
};

describeListboxContract([
  bridgedFixture,
  multiFixture,
  pickerInlineFixture,
  pickerPortalFixture,
  rampFormFixture,
]);
