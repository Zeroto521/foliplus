// test/js/control/LayerControl/ui/style/filter.fixture — shared stubs for the filter aspect suites.
import { type LayerFilter, type LayerFilterModel, select } from "#core/layer/index.js";

/** A Marker-stamped point layer whose leaves carry `feature.properties`.
 *  The values land on the row's `filterProvider` (see makeOwner below). */
export const mkPointLayer = (
  pts: Array<{ lat: number; lng: number; v: number }>,
): {
  options: Record<string, never>;
  eachLayer: (cb: (m: unknown) => void) => void;
} => {
  const markers = pts.map(p => {
    const m = new (window.L.Marker as unknown as new () => unknown)() as Record<
      string,
      unknown
    >;
    m.options = {};
    m.getLatLng = () => ({ lat: p.lat, lng: p.lng });
    m.feature = { properties: { magnitude: p.v } };
    return m;
  });
  return {
    options: {},
    eachLayer: cb => markers.forEach(cb),
  };
};

/** A minimal filter owner with the exact same contract the Heatmap manager
 *  implements: the committed filter is the only state, `filterProvider`
 *  derives the model from it, `filterSetter` stores it. No clamping — the
 *  owner's validation rules are the Heatmap tests' job; the panel only
 *  needs a read/write pair to talk to. */
export const makeOwner = (values: number[]) => {
  const range: [number, number] = [Math.min(...values), Math.max(...values)];
  const snapshot = {
    points: values.map(v => ({ lat: 0, lng: 0, fields: { magnitude: v } })),
    numericFields: ["magnitude"],
    ranges: { magnitude: range },
  };
  let filter: LayerFilter;
  return {
    filterProvider: (): LayerFilterModel => ({
      dimensions: [
        {
          kind: "range",
          field: "magnitude",
          range,
          step: 1,
        },
      ],
      filter,
      kept: select(snapshot as any, filter).length,
      total: values.length,
    }),
    filterSetter: (f: LayerFilter) => {
      filter = f;
    },
    get filter() {
      return filter;
    },
  };
};

/** A minimal enum filter owner: one Type dimension, the committed filter as
 *  its only state. The caller may hold the `values` array and mutate it to
 *  model measurements appearing/disappearing; the provider rebuilds the option
 *  list on every read. Kept counts two records per selected type so the
 *  readout proves it re-reads the owner rather than a local selection count. */
export const makeEnumOwner = (
  values: string[] = ["marker", "distance", "polygon", "circle"],
  initial?: LayerFilter,
) => {
  let filter: LayerFilter | undefined = initial;
  return {
    filterProvider: (): LayerFilterModel => {
      const options = values.map(value => ({
        value,
        label: value.toUpperCase(),
      }));
      const committed = filter;
      const selected =
        committed?.kind === "enum"
          ? options.filter(option => committed.values.includes(option.value)).length
          : options.length;
      return {
        dimensions: [{ kind: "enum", field: "type", multi: true, options }],
        filter,
        kept: selected * 2,
        total: options.length * 2,
      };
    },
    filterSetter: (next: LayerFilter) => {
      filter = next;
    },
    get filter() {
      return filter;
    },
  };
};

/** The action names of an open ⋮ menu, in DOM order (dividers carry no
 *  data-action and drop out). */
export const menuActionNames = (item: HTMLElement): string[] =>
  Array.from(
    item.querySelectorAll<HTMLElement>(".foliplus-layer-more-menu [data-action]"),
  ).map(li => li.getAttribute("data-action") ?? "");
