// core/PaneLedger — the pane lease book.
// Responsibility: "which surface owns which pane name, and did foliplus create
// the element or adopt a pre-built one" — the ownership proof PaneManager
// consults before any DOM or bookkeeping change. Pure data: no DOM, no
// Leaflet, no CONFIG. PaneManager owns the pane elements; this class only owns
// the claims on them.
//
// Invariants (T2 I1/I2):
//   - one pane name has at most one lease; the name alone is not ownership;
//   - a lease remembers its provenance — `owns` means this tree created the
//     element (the owner's teardown may delete it), `!owns` means it adopted a
//     pre-built pane (the element outlives the surface so the same id can
//     re-register without rebuilding panes);
//   - claim/release are paired by (`name`, `owner`): a foreign owner can never
//     drop another surface's lease, and a release reports which of
//     released / not-owner / absent happened instead of failing silently.
//
// TypeScript `private`, never an ES `#` field: component bundles are inlined
// into a Jinja2 template at render time and `class X { #f` would open a
// `{#` comment tag. Same rule as PaneManager (see its header).
import { createLogger } from "#common/log.js";

const log = createLogger("PaneLedger");

/** One pane booking. `owns` is provenance, not authority: both kinds are
 *  exclusive leases, only a created element is deleted by its owner. */
interface PaneLease {
  readonly name: string;
  readonly owner: string;
  readonly owns: boolean;
}

/** What a release did. Callers used to get a silent `void` for all three
 *  cases; the typed answer lets the DOM decision (delete only a created pane)
 *  ride on the same result that proved the lease was ours. */
type PaneRelease =
  | { readonly status: "released"; readonly created: boolean }
  | { readonly status: "not-owner" }
  | { readonly status: "absent" };

class PaneLedger {
  /** Pane name -> live lease. Bounded by the live surfaces' bookings plus one
   *  constant row per `PANE_OWNER` (a focus pane belongs to no surface and is
   *  never released; that row lives with the map until `clear`). */
  private readonly leases = new Map<string, PaneLease>();

  /** Book `name` for `owner`. Re-claiming a name this owner already holds is
   *  idempotent and keeps the provenance of the claim that built the element —
   *  a re-book must not turn a created pane into an adopted one (or the
   *  owner's teardown would leave its element on the map).
   *
   *  A claim from a different owner is a caller bug, not a state to absorb:
   *  the admission gate (`canAcquirePane`) runs before any claim, so reaching
   *  here with a foreign owner means two write paths disagree about who owns
   *  the pane. Throwing keeps that loud instead of silently reassigning. */
  claim(name: string, owner: string, created: boolean): PaneLease {
    const held = this.leases.get(name);
    if (held) {
      if (held.owner !== owner) {
        throw new Error(
          log.msg(
            `claim: pane "${name}" is already leased by "${held.owner}"; ` +
              `refusing the claim from "${owner}"`,
          ),
        );
      }
      return held;
    }
    const lease: PaneLease = { name, owner, owns: created };
    this.leases.set(name, lease);
    return lease;
  }

  /** The live lease on `name`, when any. */
  get(name: string): PaneLease | undefined {
    return this.leases.get(name);
  }

  /** The owner holding `name`, when any — the read the sweep uses to release
   *  under the lease's own owner instead of a name guess. */
  ownerOf(name: string): string | undefined {
    return this.leases.get(name)?.owner;
  }

  /** Whether `owner` holds `name` — the write-side gate for pane-scoped
   *  writes that resolve a pane by name. */
  leasedBy(name: string, owner: string): boolean {
    return this.leases.get(name)?.owner === owner;
  }

  /** Retire a lease. Only the owner can: a foreign caller gets `not-owner`
   *  and the lease is untouched (that is the stale-owner guard, not an
   *  error). `created` is the lease's provenance, so the caller deletes DOM
   *  only for an element this tree made. */
  release(name: string, owner: string): PaneRelease {
    const held = this.leases.get(name);
    if (!held) return { status: "absent" };
    if (held.owner !== owner) return { status: "not-owner" };
    this.leases.delete(name);
    return { status: "released", created: held.owns };
  }

  /** Every live lease, in claim order. */
  entries(): IterableIterator<[string, PaneLease]> {
    return this.leases.entries();
  }

  /** Number of live leases. */
  get size(): number {
    return this.leases.size;
  }

  /** Drop every lease — `PaneManager.destroy`'s terminal step. */
  clear(): void {
    this.leases.clear();
  }

  /** Teardown guard: assert the book is empty, naming the survivors. Used by
   *  `PaneManager.destroy` after its clears (cannot throw on a correct run)
   *  and by tests that pin the destroy end state. Not a production policy — a
   *  non-empty ledger at destroy is a defect, and a defect should be loud. */
  assertEmpty(label = "PaneLedger"): void {
    if (this.leases.size === 0) return;
    const survivors = Array.from(
      this.leases.values(),
      lease => `"${lease.name}" (${lease.owner})`,
    );
    throw new Error(
      log.msg(
        `${label}: pane ledger not empty after teardown — ` +
          `${this.leases.size} lease(s) survived: ${survivors.join(", ")}`,
      ),
    );
  }
}

export { PaneLedger };
