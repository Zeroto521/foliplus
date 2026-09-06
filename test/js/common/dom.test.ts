import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPopupHtml,
  createIconButton,
  createInlineEditInput,
  createLocationMarker,
  dom,
  escapeHTML,
  removeInlineEditInput,
  stopEvent,
  updateItemLabel,
} from "#common/dom.js";

describe("dom.el", () => {
  it("creates a basic element with tag", () => {
    const el = dom.el("div");

    expect(el.tagName).toBe("DIV");
  });

  it("sets class attribute", () => {
    const el = dom.el("div", { class: "foo bar" });

    expect(el.className).toBe("foo bar");
  });

  it("sets style from object", () => {
    const el = dom.el("div", { style: { color: "red", fontSize: "14px" } });

    expect(el.style.color).toBe("red");

    expect(el.style.fontSize).toBe("14px");
  });

  it("sets style from string", () => {
    const el = dom.el("div", { style: "color: blue; font-size: 16px" });

    expect(el.style.cssText).toContain("color: blue");
  });

  it("sets boolean properties", () => {
    const el = dom.el("input", { disabled: "", checked: true }) as HTMLInputElement;

    expect(el.disabled).toBe(true);

    expect(el.checked).toBe(true);
  });

  it("sets value property", () => {
    const el = dom.el("input", { value: "test" }) as HTMLInputElement;

    expect(el.value).toBe("test");
  });

  it("sets event handler", () => {
    const fn = vi.fn();
    const el = dom.el("button", { onclick: fn });

    el.click();

    expect(fn).toHaveBeenCalled();
  });

  it("appends child text", () => {
    const el = dom.el("p", null, "Hello");

    expect(el.textContent).toBe("Hello");
  });

  it("appends multiple children", () => {
    const el = dom.el("div", null, "A", "B", "C");

    expect(el.textContent).toBe("ABC");
  });

  it("appends a numeric child as text", () => {
    const el = dom.el("div", null, 42);

    expect(el.textContent).toBe("42");
  });

  it("inserts HTML via { html: ... }", () => {
    const el = dom.el("div", null, { html: "<span>inner</span>" });

    expect(el.querySelector("span")).not.toBeNull();

    expect(el.querySelector("span").textContent).toBe("inner");
  });

  it("appends child element", () => {
    const child = document.createElement("span");
    const el = dom.el("div", null, child);

    expect(el.firstChild).toBe(child);
  });

  it("skips null/undefined children", () => {
    const el = dom.el("div", null, "A", null, undefined, "B");

    expect(el.textContent).toBe("AB");
  });

  it("sets innerHTML", () => {
    const el = dom.el("div", { innerHTML: "<b>bold</b>" });

    expect(el.innerHTML).toBe("<b>bold</b>");
  });

  it("appends to parent via parent attr", () => {
    const parent = document.createElement("div");
    const el = dom.el("span", { parent });

    expect(parent.firstChild).toBe(el);
  });

  it("sets arbitrary attributes", () => {
    const el = dom.el("div", { "data-id": "42", title: "hello" });

    expect(el.getAttribute("data-id")).toBe("42");

    expect(el.getAttribute("title")).toBe("hello");
  });
});

describe("buildPopupHtml", () => {
  it("builds popup HTML with all fields", () => {
    const html = buildPopupHtml(
      120.5,
      30.2,
      "Some Address",
      "Location",
      "Loading...",
      "Lng,Lat:",
      "Address:",
    );

    expect(html).toContain("foliplus-popup-content");

    expect(html).toContain("Location");

    expect(html).toContain("120.5,30.2");

    expect(html).toContain("Some Address");

    expect(html).toContain("Lng,Lat:");

    expect(html).toContain("Address:");
  });

  it("shows loading indicator when addr is null", () => {
    const html = buildPopupHtml(
      120,
      30,
      null,
      "Location",
      "Loading...",
      "Lng,Lat:",
      "Address:",
    );

    expect(html).toContain("Loading...");
  });

  it("shows loading indicator when addr contains LOADING", () => {
    const html = buildPopupHtml(
      120,
      30,
      "LOADING",
      "Location",
      "Loading...",
      "Lng,Lat:",
      "Address:",
    );

    expect(html).toContain("Loading...");
  });
});

describe("createLocationMarker", () => {
  let map;

  const mockMarker = {
    bindPopup: vi.fn().mockReturnThis(),
    openPopup: vi.fn().mockReturnThis(),
    getPopup: vi.fn(() => ({
      _closeButton: null,
      isOpen: vi.fn(() => false),
    })),
    addTo: vi.fn().mockReturnThis(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    map = {
      removeLayer: vi.fn(),
      addLayer: vi.fn(),
    };

    window.L.marker = vi.fn(() => ({
      ...mockMarker,
      bindPopup: vi.fn().mockReturnThis(),
      openPopup: vi.fn().mockReturnThis(),
      getPopup: vi.fn(() => ({
        _closeButton: null,
        isOpen: vi.fn(() => false),
      })),
      addTo: vi.fn().mockReturnThis(),
    }));

    window.L.divIcon = vi.fn(() => ({}));
  });

  it("creates a marker with popup", () => {
    const marker = createLocationMarker(
      map,
      120,
      30,
      "Address",
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
    );

    expect(window.L.marker).toHaveBeenCalledWith([30, 120], expect.any(Object));

    expect(map.addLayer).toHaveBeenCalled();

    expect(marker.bindPopup).toHaveBeenCalled();

    expect(marker.openPopup).toHaveBeenCalled();
  });

  it("removes existing marker", () => {
    const existing = { _map: map };

    createLocationMarker(
      map,
      120,
      30,
      "Address",
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
      "en",
      existing,
    );

    expect(map.removeLayer).toHaveBeenCalledWith(existing);
  });

  it("adds marker to layerGroup instead of map", () => {
    const layerGroup = { addLayer: vi.fn() };

    createLocationMarker(
      map,
      120,
      30,
      "Address",
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
      "en",
      null,
      layerGroup,
    );

    expect(layerGroup.addLayer).toHaveBeenCalled();

    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("does not open popup when openPopup is false", () => {
    const marker = createLocationMarker(
      map,
      120,
      30,
      "Address",
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
      "en",
      null,
      null,
      null,
      false,
    );

    expect(marker.openPopup).not.toHaveBeenCalled();
  });

  it("calls onAddress and updates popup when reverseGeocode resolves", async () => {
    const marker = {
      bindPopup: vi.fn().mockReturnThis(),
      openPopup: vi.fn(),
      setPopupContent: vi.fn(),
      getPopup: () => ({
        _closeButton: null,
        isOpen: vi.fn(() => true),
      }),
    };

    window.L.marker = vi.fn(() => marker);

    window.foliplus.reverseGeocode = vi.fn(() => Promise.resolve("Resolved Address"));
    const onAddress = vi.fn();

    createLocationMarker(
      map,
      120,
      30,
      null,
      "Title",
      "Loading...",
      "Lng,Lat:",
      "Address:",
      "Close",
      "en",
      null,
      null,
      onAddress,
    );

    await Promise.resolve();

    await Promise.resolve();

    expect(onAddress).toHaveBeenCalledWith("Resolved Address");

    expect(marker.setPopupContent).toHaveBeenCalled();
  });

  it("does nothing when reverseGeocode is unavailable", () => {
    delete window.foliplus.reverseGeocode;

    expect(() =>
      createLocationMarker(
        map,
        120,
        30,
        null,
        "Title",
        "Loading...",
        "Lng,Lat:",
        "Address:",
        "Close",
      ),
    ).not.toThrow();
  });
});

describe("createIconButton", () => {
  it("creates a button with class, title, and svg content", () => {
    const btn = createIconButton({
      class: "foliplus-tool-btn",
      title: "Zoom in",
      svg: "<svg/>",
    });

    expect(btn.tagName).toBe("BUTTON");

    expect(btn.className).toBe("foliplus-tool-btn");

    expect(btn.title).toBe("Zoom in");

    // insertAdjacentHTML normalizes the self-closing tag.
    expect(btn.innerHTML).toBe("<svg></svg>");
  });

  it("appends to parent when provided", () => {
    const parent = document.createElement("div");
    const btn = createIconButton({ class: "btn", svg: "<svg/>", parent });

    expect(parent.contains(btn)).toBe(true);
  });

  it("sets aria-label when provided", () => {
    const btn = createIconButton({
      class: "btn",
      title: "T",
      ariaLabel: "A",
      svg: "<svg/>",
    });

    expect(btn.getAttribute("aria-label")).toBe("A");
  });

  it("omits aria-label when not provided", () => {
    const btn = createIconButton({ class: "btn", title: "T", svg: "<svg/>" });

    expect(btn.hasAttribute("aria-label")).toBe(false);
  });

  it("sets data-* attributes from data map", () => {
    const btn = createIconButton({
      class: "btn",
      svg: "<svg/>",
      data: { mode: "distance" },
    });

    expect(btn.getAttribute("data-mode")).toBe("distance");
  });

  it("assigns onclick handler", () => {
    const fn = vi.fn();
    const btn = createIconButton({ class: "btn", svg: "<svg/>", onclick: fn });

    btn.click();

    expect(fn).toHaveBeenCalled();
  });
});

describe("stopEvent", () => {
  it("stops propagation and prevents default on a DOM event", () => {
    const event = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as Event;

    stopEvent(event);

    expect(event.stopPropagation).toHaveBeenCalled();

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("unwraps Leaflet events via originalEvent", () => {
    const original = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as Event;

    stopEvent({ originalEvent: original });

    expect(original.stopPropagation).toHaveBeenCalled();

    expect(original.preventDefault).toHaveBeenCalled();
  });
});

describe("escapeHTML", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHTML(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("coerces non-strings", () => {
    expect(escapeHTML(5)).toBe("5");
  });
});

describe("updateItemLabel", () => {
  it("updates the label text and the checkbox aria-label only", () => {
    const item = dom.el("div", { "data-layer-id": "a" });

    item.appendChild(dom.el("label", null, "Old"));
    const checkbox = dom.el("input", { type: "checkbox" }) as HTMLInputElement;
    const colorInput = dom.el("input", { type: "color" }) as HTMLInputElement;

    item.appendChild(checkbox);

    item.appendChild(colorInput);

    document.body.appendChild(item);

    const label = updateItemLabel(item, "New");

    expect(label?.textContent).toBe("New");

    expect(checkbox.getAttribute("aria-label")).toBe("New");

    // The tooltip slot stays the Select/Deselect label — a layer name in
    // there reads as a tooltip for the wrong control.
    expect(checkbox.title).toBe("");

    // A row with both toggles keeps the color input as a separate control.
    expect(colorInput.getAttribute("aria-label")).toBeNull();

    expect(colorInput.title).toBe("");
  });

  it("updates the color input's aria-label when the row has no checkbox", () => {
    // The color basemap row's only toggle is the swatch, so it must be the
    // one that announces the rename — otherwise assistive tech keeps reading
    // the locale default after a rename.
    const item = dom.el("div", { "data-layer-id": "color" });

    item.appendChild(dom.el("label", null, "Old"));
    const colorInput = dom.el("input", { type: "color" }) as HTMLInputElement;

    colorInput.setAttribute("aria-label", "Old");

    item.appendChild(colorInput);

    document.body.appendChild(item);

    updateItemLabel(item, "New");

    expect(colorInput.getAttribute("aria-label")).toBe("New");

    // `title` is the tooltip slot, not the name — a rename must not move
    // into it.
    expect(colorInput.title).toBe("");
  });

  it("updates just the label when the item has no checkbox", () => {
    const item = dom.el("div", null);

    item.appendChild(dom.el("label", null, "OnlyLabel"));
    const label = updateItemLabel(item, "Renamed");

    expect(label?.textContent).toBe("Renamed");
  });

  it("returns null for a null item or a label-less item", () => {
    expect(updateItemLabel(null, "x")).toBeNull();

    expect(updateItemLabel(dom.el("div"), "x")).toBeNull();
  });

  it("returns null when the label itself is absent", () => {
    const item = dom.el("div", { "data-layer-id": "b" });

    item.appendChild(dom.el("input", { type: "checkbox" }));

    expect(updateItemLabel(item, "x")).toBeNull();
  });
});

describe("removeInlineEditInput", () => {
  it("removes the first input from a label", () => {
    const label = dom.el("label");
    const input = dom.el("input", { type: "text" });

    label.appendChild(input);

    label.appendChild(dom.el("span", null, "trailing"));

    const removed = removeInlineEditInput(label as HTMLLabelElement);

    expect(removed).toBe(input);

    expect(label.querySelector("input")).toBeNull();

    // trailing content preserved
    expect(label.textContent).toBe("trailing");
  });

  it("returns null for a null label", () => {
    expect(removeInlineEditInput(null)).toBeNull();
  });
});

describe("createInlineEditInput", () => {
  it("creates a focused, selected input seeded with the initial value", () => {
    const label = dom.el("label");

    document.body.appendChild(label);

    const input = createInlineEditInput({
      label: label as HTMLLabelElement,
      initialValue: "Start",
      className: "editing",
      ariaLabel: "Rename",
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(input).toBeInstanceOf(HTMLInputElement);

    expect(input.value).toBe("Start");

    expect(input.className).toContain("editing");

    expect(input.getAttribute("aria-label")).toBe("Rename");

    expect(label.querySelector("input")).toBe(input);
  });

  it("commits a trimmed non-empty value on Enter", () => {
    const label = dom.el("label");

    document.body.appendChild(label);
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    const input = createInlineEditInput({
      label: label as HTMLLabelElement,
      initialValue: "",
      className: "",
      ariaLabel: "",
      onCommit,
      onCancel,
    });

    input.value = "  Trimmed  ";

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(onCommit).toHaveBeenCalledWith("Trimmed");

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape without committing", () => {
    const label = dom.el("label");

    document.body.appendChild(label);
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    const input = createInlineEditInput({
      label: label as HTMLLabelElement,
      initialValue: "",
      className: "",
      ariaLabel: "",
      onCommit,
      onCancel,
    });

    input.value = "abandon";

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

    expect(onCancel).toHaveBeenCalled();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows the cancel path for an empty/whitespace Enter", () => {
    const label = dom.el("label");

    document.body.appendChild(label);
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    const input = createInlineEditInput({
      label: label as HTMLLabelElement,
      initialValue: "",
      className: "",
      ariaLabel: "",
      onCommit,
      onCancel,
    });

    input.value = "   ";

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(onCancel).toHaveBeenCalled();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits on blur with the current value", () => {
    const label = dom.el("label");

    document.body.appendChild(label);
    const onCommit = vi.fn();

    const input = createInlineEditInput({
      label: label as HTMLLabelElement,
      initialValue: "",
      className: "",
      ariaLabel: "",
      onCommit,
      onCancel: vi.fn(),
    });

    input.value = "BlurValue";

    input.dispatchEvent(new Event("blur"));

    expect(onCommit).toHaveBeenCalledWith("BlurValue");
  });

  it("skips blur-commit while isActive returns false (double-commit guard)", () => {
    const label = dom.el("label");

    document.body.appendChild(label);
    const onCommit = vi.fn();

    const input = createInlineEditInput({
      label: label as HTMLLabelElement,
      initialValue: "",
      className: "",
      ariaLabel: "",
      onCommit,
      onCancel: vi.fn(),
      isActive: () => false, // e.g. Enter/Escape already tore the input down
    });

    input.value = "stale";

    input.dispatchEvent(new Event("blur"));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits on blur when isActive returns true", () => {
    const label = dom.el("label");

    document.body.appendChild(label);
    const onCommit = vi.fn();

    const input = createInlineEditInput({
      label: label as HTMLLabelElement,
      initialValue: "",
      className: "",
      ariaLabel: "",
      onCommit,
      onCancel: vi.fn(),
      isActive: () => true,
    });

    input.value = "StillActive";

    input.dispatchEvent(new Event("blur"));

    expect(onCommit).toHaveBeenCalledWith("StillActive");
  });

  it("clears the label text and appends the input", () => {
    const label = dom.el("label");

    label.appendChild(document.createTextNode("Original"));

    document.body.appendChild(label);

    const input = createInlineEditInput({
      label: label as HTMLLabelElement,
      initialValue: "",
      className: "",
      ariaLabel: "",
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    });
    const labelText = label.textContent;

    expect(labelText).toBe("");

    expect(label.contains(input)).toBe(true);
  });

  it("stops every key from bubbling so arrow keys keep the caret", () => {
    const label = dom.el("label");

    document.body.appendChild(label);
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    const input = createInlineEditInput({
      label: label as HTMLLabelElement,
      initialValue: "SomeName",
      className: "",
      ariaLabel: "",
      onCommit,
      onCancel,
    });

    // A document-level listener stands in for the InteractionManager; it must
    // NOT receive the ArrowLeft keydown, otherwise it would preventDefault and
    // swallow the caret move.
    const docListener = vi.fn();

    document.addEventListener("keydown", docListener);

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      }),
    );

    document.removeEventListener("keydown", docListener);

    expect(docListener).not.toHaveBeenCalled();

    // Arrow keys must not commit or cancel — only Enter/Escape do.
    expect(onCommit).not.toHaveBeenCalled();

    expect(onCancel).not.toHaveBeenCalled();
  });
});
