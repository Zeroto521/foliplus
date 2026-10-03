// core/guard — per-map foliplus namespace accessor.
//
// `requireFoliplus(map)` returns the per-map `MapFoliplus` namespace or
// throws when the runtime hasn't seeded it yet. Callers that used to write
// `map.foliplus!.showHint(...)` (the `!` operator hides the "undefined
// now, TypeError later" bug) switch to `requireFoliplus(map).showHint(...)`.
//
// Cleanup paths (destroy / onUnload / post-detach) legitimately see an
// undefined or torn-down namespace and stay on `map.foliplus?.` — the
// accessor is for the "runtime must be live" call sites only.
import { createLogger } from "#common/log.js";

const log = createLogger("foliplus");

/** Read the per-map foliplus namespace. Throws when the runtime hasn't
 *  seeded it — a programming error, since every control reaches the
 *  namespace through an `ensure*` factory first. */
const requireFoliplus = (map: L.Map): MapFoliplus => {
  const ns = map.foliplus;
  if (!ns) {
    throw new Error(
      log.msg(
        "no per-map namespace on this L.Map — did the runtime fail to " +
          "initialize? Component entry should call an ensure* factory first.",
      ),
    );
  }
  return ns;
};

export { requireFoliplus };
