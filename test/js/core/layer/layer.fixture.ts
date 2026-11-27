// Layer-class stubs for the core/layer tests: setup.ts defines L.Polygon and
// L.Polyline but not L.Marker / L.CircleMarker, and the geometry predicates are
// instanceof checks. Shared so the split test files do not each carry a copy.

export const stubLayerClasses = (): void => {
  if (!window.L.Marker) {
    window.L.Marker = class Marker {
      feature: unknown = null;
    };
  }
  if (!window.L.CircleMarker) {
    window.L.CircleMarker = class CircleMarker {
      feature: unknown = null;
    };
  }
};
