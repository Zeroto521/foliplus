import { describe, expect, it, vi } from "vitest";
import {
  findLeaf,
  isContainerNode,
  someLeaf,
  walkLeaf,
  walkTree,
} from "#core/layer/walkLeaf.js";

// The adapter is mocked so we can construct nodes whose isGroupLike /
// internalLayers disagree — the one case the real adapter cannot produce
// (a group-like node with no _layers registry) and the defensive
// `reg ? … : []` fallback exists to handle.
const adapterMock = vi.hoisted(() => ({
  isGroupLike: (node: unknown) => {
    const n = node as Record<string, unknown>;
    return (
      typeof n.eachLayer === "function" || Boolean(n._layers) || Boolean(n.__forceGroup)
    );
  },
  internalLayers: (node: unknown) => {
    const n = node as Record<string, unknown>;
    if (n.__noLayers) return undefined;
    return n._layers;
  },
}));

vi.mock("#core/leafletAdapter.js", () => ({
  isGroupLike: adapterMock.isGroupLike,
  internalLayers: adapterMock.internalLayers,
}));

// A minimal Leaflet-style container: eachLayer callback style.
const group = (...children: unknown[]) => ({
  eachLayer: (fn: (l: unknown) => void) => children.forEach(fn),
});

const leaf = (tag = "") => ({ __tag: tag });

describe("walkLeaf", () => {
  it("visits every leaf and skips containers", () => {
    const a = leaf("a");
    const b = leaf("b");
    const g = group(a, b);
    const visited: string[] = [];
    walkLeaf(g, l => visited.push((l as { __tag: string }).__tag));
    expect(visited).toEqual(["a", "b"]);
  });

  it("depth guard: does not recurse past maxDepth", () => {
    const deepLeaf = leaf("deep");
    const g = group(deepLeaf);
    const visited: string[] = [];
    // maxDepth=0: the container itself is visited at depth=0 (0 > 0 is false),
    // but its child at depth=1 > 0 returns early.
    walkLeaf(g, l => visited.push((l as { __tag: string }).__tag), 0, 0);
    expect(visited).toEqual([]);
  });

  it("returns early on a falsy layer", () => {
    const fn = vi.fn();
    walkLeaf(null, fn);
    walkLeaf(undefined, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("childrenOf: returns [] when internalLayers is falsy (defensive fallback)", () => {
    // A node the adapter reports as group-like but whose _layers registry is
    // absent — childrenOf must not throw; it returns an empty list, so the
    // walk treats the node as an empty container (no leaves visited).
    const node = { __forceGroup: true, __noLayers: true };
    const visited: unknown[] = [];
    walkLeaf(node, l => visited.push(l));
    expect(visited).toEqual([]);
  });
});

describe("walkTree", () => {
  it("visits containers and leaves", () => {
    const a = leaf("a");
    const g = group(a);
    const visited: unknown[] = [];
    walkTree(g, l => visited.push(l));
    expect(visited).toEqual([g, a]);
  });

  it("depth guard: does not recurse past maxDepth", () => {
    const deepLeaf = leaf("deep");
    const g = group(deepLeaf);
    const visited: unknown[] = [];
    // maxDepth=0: container visited at depth=0, child at depth=1 is skipped.
    walkTree(g, l => visited.push(l), 0, 0);
    expect(visited).toEqual([g]);
  });
});

describe("findLeaf", () => {
  it("returns the first leaf for which pred produces a value", () => {
    const a = leaf("a");
    const b = leaf("b");
    const g = group(a, b);
    const result = findLeaf(g, l =>
      (l as { __tag: string }).__tag === "b" ? "found" : undefined,
    );
    expect(result).toBe("found");
  });

  it("skips children whose pred returns undefined and continues the search", () => {
    // The undefined arm of `if (r !== undefined) return r` — the first child
    // returns undefined, the second returns a value, and the walk must skip
    // the first and return the second.
    const miss = leaf("miss");
    const hit = leaf("hit");
    const g = group(miss, hit);
    const result = findLeaf(g, l =>
      (l as { __tag: string }).__tag === "hit" ? "value" : undefined,
    );
    expect(result).toBe("value");
  });

  it("returns undefined when no leaf matches and depth is exceeded", () => {
    const g = group(leaf("x"));
    const result = findLeaf(g, () => undefined, 0, 0);
    expect(result).toBeUndefined();
  });
});

describe("someLeaf", () => {
  it("returns true when any leaf matches", () => {
    const g = group(leaf("a"), leaf("b"));
    expect(someLeaf(g, () => true)).toBe(true);
  });

  it("returns false when no leaf matches", () => {
    const g = group(leaf("a"), leaf("b"));
    expect(someLeaf(g, () => false)).toBe(false);
  });

  it("depth guard: returns false when depth is exceeded", () => {
    const g = group(leaf("x"));
    expect(someLeaf(g, () => true, 0, 0)).toBe(false);
  });
});

describe("isContainerNode", () => {
  it("true when eachLayer is a function", () => {
    expect(isContainerNode({ eachLayer: () => {} })).toBe(true);
  });

  it("false when eachLayer is absent", () => {
    expect(isContainerNode({})).toBe(false);
    expect(isContainerNode(null)).toBe(false);
    expect(isContainerNode(undefined)).toBe(false);
  });
});
