// Seed a persisted layer-state record into localStorage before the page's
// own scripts run. Playwright Python's ``add_init_script`` takes only a
// script string (no ``arg`` parameter), so the two placeholders are baked
// in via ``str.replace`` at the call site.
//
// The seed placeholder stands alone (no surrounding quotes) because the
// replacement is ``json.dumps(json.dumps(seed))`` — a JS string literal that
// already carries its own ``"`` delimiters and JSON escapes.
localStorage.setItem("foliplus_layer_state___KEY__", __SEED__);
