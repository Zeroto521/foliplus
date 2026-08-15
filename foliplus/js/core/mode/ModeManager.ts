// core/mode/ModeManager — cross-component active-mode registry.
// Tracks the active mode of each participating component (MeasureControl
// measurement mode, SearchControl coord/addr, ...) and emits MODE_CHANGE on
// the per-map EventBus whenever a mode changes. Components opt in by calling
// setMode(component, mode); others can read getMode(component) or subscribe.
// No DOM / CONF dependency.
import { MODE_CHANGE, type EventBus } from "../event/index.js";

export interface ModeChangePayload {
  component: string;
  mode: string | null;
}

export class ModeManager {
  private modes = new Map<string, string | null>();

  constructor(private readonly bus: EventBus) {}

  /** Current mode for a component, or null when unset. */
  getMode(component: string): string | null {
    return this.modes.get(component) ?? null;
  }

  /** Set a component's active mode; emits MODE_CHANGE only when it changes. */
  setMode(component: string, mode: string | null): void {
    if (this.modes.get(component) === mode) return;
    this.modes.set(component, mode);
    this.bus.emit(MODE_CHANGE, { component, mode } satisfies ModeChangePayload);
  }

  /** All components with a recorded mode (diagnostics/tests). */
  keys(): string[] {
    return [...this.modes.keys()];
  }

  clear(): void {
    this.modes.clear();
  }
}
