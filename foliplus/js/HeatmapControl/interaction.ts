// HeatmapControl interaction — scheme bar/dropdown keyboard events.
// The scheme bar/dropdown keyboard handlers have been migrated to
// common/schemePicker.ts (B2). This file previously exported
// registerSchemeBarEvents and registerDropdownEvents; both are now
// internal to the picker component. The Escape class-name bug
// ("foliplus-scheme-bar-open" instead of "foliplus-heatmap-scheme-bar-open")
// in the old registerDropdownEvents is fixed by removal.

// ensureInteraction is no longer needed — the scheme bar/dropdown
// keyboard handlers have been migrated to common/schemePicker.ts.

export {};
