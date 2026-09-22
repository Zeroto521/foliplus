import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountDelIcon } from "#common/deliconMount.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mountDelIcon", () => {
  // Same real-DOM trick as the SearchControl tests: toggleDelIcon flips the ✕
  // span's class on the element the mock marker reports.
  const makeDelIconWithEl = () => {
    const span = document.createElement("span");
    span.setAttribute("data-del-icon", "");
    const wrap = document.createElement("div");
    wrap.appendChild(span);
    const on = vi.fn();
    window.L.marker = vi.fn(() => ({ on, getElement: () => wrap }));
    return { span, on };
  };

  it("mounts the created icon through the mounter and fires onDelete on a ✕ click", () => {
    const { span, on } = makeDelIconWithEl();
    const mount = vi.fn();
    const onDelete = vi.fn();
    const delIcon = mountDelIcon(
      { lat: 1, lng: 2 },
      { title: "Del", iconAnchor: [0, 24] },
      mount,
      onDelete,
    );

    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledWith(delIcon);

    const click = on.mock.calls.find(c => c[0] === "click")?.[1];
    click({ originalEvent: { target: span } });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("binds the ✕ to the popup lifecycle when popupMarker is given", () => {
    const { span } = makeDelIconWithEl();
    const popupMarker = { on: vi.fn() };
    mountDelIcon({ lat: 1, lng: 2 }, {}, vi.fn(), vi.fn(), popupMarker);

    expect(popupMarker.on).toHaveBeenCalledWith("popupopen", expect.any(Function));
    expect(popupMarker.on).toHaveBeenCalledWith("popupclose", expect.any(Function));
    popupMarker.on.mock.calls[0][1]();
    expect(span.classList.contains("visible")).toBe(true);
    popupMarker.on.mock.calls[1][1]();
    expect(span.classList.contains("visible")).toBe(false);
  });

  it("skips the popup binding when popupMarker is omitted or null", () => {
    const { on } = makeDelIconWithEl();
    mountDelIcon({ lat: 1, lng: 2 }, {}, vi.fn(), vi.fn());
    expect(on.mock.calls).toHaveLength(1);
    expect(on.mock.calls[0][0]).toBe("click");
    expect(() =>
      mountDelIcon({ lat: 1, lng: 2 }, {}, vi.fn(), vi.fn(), null),
    ).not.toThrow();
  });
});
