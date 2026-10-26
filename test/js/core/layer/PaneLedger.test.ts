import { beforeEach, describe, expect, it } from "vitest";
import { PaneLedger } from "#foliplus/core/layer/PaneLedger.js";

// Mixed DOM/Leaflet logic is covered by PaneManager.test.ts; this file pins the
// book itself — provenance, the claim/release pairing, and the destroy guards.
describe("PaneLedger", () => {
  let ledger: PaneLedger;

  beforeEach(() => {
    ledger = new PaneLedger();
  });

  describe("claim", () => {
    it("books a free name with its owner and provenance", () => {
      const lease = ledger.claim("foliplus-pane-a", "surface-a", true);

      expect(lease).toEqual({
        name: "foliplus-pane-a",
        owner: "surface-a",
        owns: true,
      });
      expect(ledger.get("foliplus-pane-a")).toBe(lease);
      expect(ledger.ownerOf("foliplus-pane-a")).toBe("surface-a");
      expect(ledger.size).toBe(1);
    });

    it("keeps the created provenance across a same-owner re-book", () => {
      // The call that built the element owns the provenance for the life of
      // the lease: a re-book reported as "adopted" must not turn a created
      // pane into one whose teardown leaves the element behind.
      const first = ledger.claim("foliplus-pane-a", "surface-a", true);
      const again = ledger.claim("foliplus-pane-a", "surface-a", false);

      expect(again).toBe(first);
      expect(again.owns).toBe(true);
      expect(ledger.size).toBe(1);
    });

    it("keeps the adopted provenance across a same-owner re-book", () => {
      ledger.claim("foliplus-pane-a", "surface-a", false);

      expect(ledger.claim("foliplus-pane-a", "surface-a", true).owns).toBe(false);
    });

    it("refuses a claim from a different owner and keeps the lease", () => {
      ledger.claim("foliplus-pane-a", "surface-a", true);

      expect(() => ledger.claim("foliplus-pane-a", "surface-b", true)).toThrow(
        /\[PaneLedger\] claim: pane "foliplus-pane-a" is already leased by "surface-a"; refusing the claim from "surface-b"/,
      );
      expect(ledger.ownerOf("foliplus-pane-a")).toBe("surface-a");
    });
  });

  describe("release", () => {
    it("answers absent for a name that was never claimed", () => {
      expect(ledger.release("foliplus-pane-a", "surface-a")).toEqual({
        status: "absent",
      });
      expect(ledger.size).toBe(0);
    });

    it("answers not-owner and keeps the lease for a foreign caller", () => {
      ledger.claim("foliplus-pane-a", "surface-a", true);

      expect(ledger.release("foliplus-pane-a", "surface-b")).toEqual({
        status: "not-owner",
      });
      expect(ledger.leasedBy("foliplus-pane-a", "surface-a")).toBe(true);
      expect(ledger.size).toBe(1);
    });

    it("reports the created provenance on release", () => {
      ledger.claim("foliplus-pane-a", "surface-a", true);

      expect(ledger.release("foliplus-pane-a", "surface-a")).toEqual({
        status: "released",
        created: true,
      });
      expect(ledger.get("foliplus-pane-a")).toBeUndefined();
      expect(ledger.size).toBe(0);
    });

    it("reports the adopted provenance on release", () => {
      ledger.claim("foliplus-pane-a", "surface-a", false);

      expect(ledger.release("foliplus-pane-a", "surface-a")).toEqual({
        status: "released",
        created: false,
      });
    });

    it("lets another owner claim the name after release", () => {
      ledger.claim("foliplus-pane-a", "surface-a", true);
      ledger.release("foliplus-pane-a", "surface-a");

      const lease = ledger.claim("foliplus-pane-a", "surface-b", true);
      expect(lease.owner).toBe("surface-b");
      expect(ledger.leasedBy("foliplus-pane-a", "surface-b")).toBe(true);
    });
  });

  describe("reads", () => {
    it("exposes ownerOf, leasedBy, size and entries in claim order", () => {
      ledger.claim("foliplus-pane-a", "surface-a", true);
      ledger.claim("foliplus-pane-b", "surface-b", false);

      expect(ledger.ownerOf("foliplus-pane-a")).toBe("surface-a");
      expect(ledger.ownerOf("foliplus-pane-b")).toBe("surface-b");
      expect(ledger.ownerOf("foliplus-pane-c")).toBeUndefined();
      expect(ledger.leasedBy("foliplus-pane-a", "surface-a")).toBe(true);
      expect(ledger.leasedBy("foliplus-pane-a", "surface-b")).toBe(false);
      expect(ledger.leasedBy("foliplus-pane-c", "surface-a")).toBe(false);
      expect(ledger.size).toBe(2);
      expect(Array.from(ledger.entries(), ([name]) => name)).toEqual([
        "foliplus-pane-a",
        "foliplus-pane-b",
      ]);
    });
  });

  describe("teardown", () => {
    it("clear drops every lease", () => {
      ledger.claim("foliplus-pane-a", "surface-a", true);
      ledger.claim("foliplus-pane-b", "surface-b", false);

      ledger.clear();

      expect(ledger.size).toBe(0);
      expect(ledger.get("foliplus-pane-a")).toBeUndefined();
    });

    it("assertEmpty passes on an empty ledger, custom label or not", () => {
      expect(() => ledger.assertEmpty()).not.toThrow();
      expect(() => ledger.assertEmpty("PaneManager.destroy")).not.toThrow();
    });

    it("assertEmpty names the surviving leases and the label", () => {
      ledger.claim("foliplus-pane-a", "surface-a", true);
      ledger.claim("foliplus-pane-b", "surface-b", false);

      expect(() => ledger.assertEmpty("PaneManager.destroy")).toThrow(
        /\[PaneLedger\] PaneManager\.destroy: pane ledger not empty after teardown — 2 lease\(s\) survived: "foliplus-pane-a" \(surface-a\), "foliplus-pane-b" \(surface-b\)/,
      );
    });
  });
});
