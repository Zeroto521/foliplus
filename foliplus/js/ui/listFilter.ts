// ui/listFilter — pure filter core for a searchable option list.
//
// This module owns ONE thing: turning an item set + a query into the matched
// subset, with the query-normalization work done once per item set. It is
// deliberately DOM-free and import-free (it must not import dropdown or any
// other ui module) so any list surface — a dropdown, a future layer list, a
// SearchControl result set — can reuse the same matching semantics without
// dragging in a dropdown's chrome.
//
// Contract:
// - normalize() is called once per item set (e.g. on popup open). It builds a
//   parallel array of lowercased trimmed labels so every later setQuery() is a
//   plain O(n) scan, never a per-item lower/trim again.
// - matches() returns the items whose label contains the query (case-insensitive,
//   trimmed). It never mutates the source items.
// - total is the item-set length; matched is the filtered length. The caller
//   decides what to render and how to report shown/total — this module does not
//   count pinned rows (that is a selection-surface concern, not a filter one).

type ListFilterItem = {
  /** The display text the query matches against. */
  readonly label: string;
};

type ListFilter<T extends ListFilterItem> = {
  /** Rebuild the normalized label cache from a new item set (O(n)). */
  normalize(items: readonly T[]): void;
  /** Set the query and return the matched subset. Empty/whitespace query
   *  returns the full item set. Never mutates the source items. */
  setQuery(query: string): readonly T[];
  /** The full item-set length (set by the last normalize call). */
  total(): number;
  /** The number of items matched by the current query. */
  matched(): number;
};

/** Create a pure filter over an item set. Call normalize() once when the item
 *  set is (re)built; then setQuery() is O(n) over the cached labels. */
const createListFilter = <T extends ListFilterItem>(): ListFilter<T> => {
  let items: readonly T[] = [];
  let labels: readonly string[] = [];
  let query = "";

  const normalize = (next: readonly T[]): void => {
    items = next;
    labels = next.map(item => item.label.toLowerCase().trim());
  };

  const setQuery = (next: string): readonly T[] => {
    query = next.trim().toLowerCase();
    if (query === "") return items;
    const out: T[] = [];
    for (let i = 0; i < items.length; i++) {
      if (labels[i].includes(query)) out.push(items[i]);
    }
    return out;
  };

  return {
    normalize,
    setQuery,
    total: () => items.length,
    matched: () => {
      if (query === "") return items.length;
      let count = 0;
      for (let i = 0; i < items.length; i++) {
        if (labels[i].includes(query)) count++;
      }
      return count;
    },
  };
};

export { createListFilter };
export type { ListFilter, ListFilterItem };
