// core/component — canonical component name constants.
// Single source of truth for every foliplus component identity.
// Components use CONF.name (runtime, from Python) for self-reference;
// cross-component references use COMPONENTS.xxx (compile-time constant).

export const COMPONENTS = {
  MeasureControl: "MeasureControl",
  ExportControl: "ExportControl",
  SearchControl: "SearchControl",
  LocateControl: "LocateControl",
  FullscreenControl: "FullscreenControl",
  LayerManager: "LayerManager",
  LayerControl: "LayerControl",
  HeatmapControl: "HeatmapControl",
} as const;

export type ComponentName = (typeof COMPONENTS)[keyof typeof COMPONENTS];

/** Generate a namespaced ID for multi-instance support.
 *  e.g. generateId("foliplus_measure", "a") → "foliplus_measure_a". */
export const generateId = (prefix: string, namespace?: string): string =>
  namespace ? `${prefix}_${namespace}` : prefix;

/** Runtime assertion that a CONF.name matches a known component.
 *  Call early in component initialisation (constructor / onAdd). */
export function assertComponentName(name: string): void {
  if (!(Object.values(COMPONENTS) as string[]).includes(name)) {
    console.error(
      `[foliplus] Invalid component name: "${name}". ` +
        `Must be one of: ${Object.values(COMPONENTS).join(", ")}`,
    );
  }
}
