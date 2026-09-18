import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REVOKE_DELAY, download } from "#common/download.js";

describe("download", () => {
  let createdUrls: string[];
  let revokedUrls: string[];
  let lastAnchor: any;

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    lastAnchor = null;

    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:fake-${createdUrls.length}`;
        createdUrls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revokedUrls.push(url)),
    });

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(tag => {
      if (String(tag).toLowerCase() === "a") {
        const a = origCreate("a") as HTMLAnchorElement;
        a.click = vi.fn();
        const realRemove = a.remove.bind(a);
        a.remove = vi.fn(() => {
          if (a.isConnected) realRemove();
        });
        lastAnchor = a;
        return a;
      }
      return origCreate(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("downloads the blob under the given filename", () => {
    const blob = new Blob(["geojson"], { type: "application/geo+json" });
    download(blob, "measurements.geojson");

    expect(lastAnchor.download).toBe("measurements.geojson");
    expect(lastAnchor.href).toBe(createdUrls[0]);
    expect(lastAnchor.rel).toBe("noopener");
    expect(lastAnchor.click).toHaveBeenCalled();
    expect(createdUrls).toHaveLength(1);
  });

  it("passes the blob through to createObjectURL untouched", () => {
    const blob = new Blob(["abc"], { type: "text/csv" });
    download(blob, "x.csv");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("releases the object URL after the default delay", () => {
    vi.useFakeTimers();
    download(new Blob(["x"], { type: "text/plain" }), "x.txt");

    expect(revokedUrls).toHaveLength(0);
    vi.advanceTimersByTime(DEFAULT_REVOKE_DELAY - 1);
    expect(revokedUrls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(revokedUrls).toEqual([createdUrls[0]]);
  });

  it("honours a custom revoke delay", () => {
    vi.useFakeTimers();
    download(new Blob(["x"], { type: "text/plain" }), "x.txt", 150);

    vi.advanceTimersByTime(150);
    expect(revokedUrls).toEqual([createdUrls[0]]);
  });

  it("detaches the anchor instead of leaving it in the DOM", () => {
    download(new Blob(["x"], { type: "text/plain" }), "x.txt");

    expect(lastAnchor.remove).toHaveBeenCalled();
    expect(document.body.contains(lastAnchor)).toBe(false);
  });

  it("hides the anchor so it never shows as a visible link", () => {
    download(new Blob(["x"], { type: "text/plain" }), "x.txt");
    expect(lastAnchor.style.display).toBe("none");
  });

  it("detaches the anchor and schedules revoke when click() throws", () => {
    vi.useFakeTimers();
    // The anchor only exists once createElement runs, so the throwing click is
    // injected at creation time rather than patched on afterwards.
    vi.spyOn(document, "createElement").mockImplementationOnce(tag => {
      const a = document.createElement(String(tag)) as HTMLAnchorElement;
      a.click = vi.fn(() => {
        throw new Error("blocked by browser");
      });
      lastAnchor = a;
      return a;
    });

    // Captured rather than .toThrow(): that matcher rethrows the original
    // error, which would mask the cleanup finally already performed.
    let thrown: unknown = null;
    try {
      download(new Blob(["x"], { type: "text/plain" }), "x.txt");
    } catch (err) {
      thrown = err;
    }
    expect(String(thrown)).toContain("blocked by browser");

    // The error still reaches the caller, but the URL must be released on
    // schedule — a throw is exactly the case the leak would otherwise hit.
    expect(document.body.contains(lastAnchor)).toBe(false);
    expect(revokedUrls).toHaveLength(0);
    vi.advanceTimersByTime(DEFAULT_REVOKE_DELAY);
    expect(revokedUrls).toEqual([createdUrls[0]]);
  });
});
