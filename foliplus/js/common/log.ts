// common/log — namespaced foliplus diagnostics.
// Every foliplus console message and thrown error shares a `[<name>]` prefix
// so output is greppable and attributable at a glance. Components pass
// CONF.name; shared modules that take a caller name (e.g. storage) keep their
// parameterised one.
//
// Two shapes, kept deliberately distinct:
//   log line  "[LayerControl] dropped stale ids"  — prefix, space, sentence
//   thrown    "[LayerRegistry]: cannot delete"    — prefix, colon, title
// A log is a statement; an error message is the stack trace's heading. The
// separator is what tells them apart.

/** Build the namespaced message for a log line or thrown error. */
const msg = (name: string, message: string, separator: " " | ": "): string =>
  `[${name}]${separator}${message}`;

/** A logger bound to a fixed `[<name>] ` prefix. */
type LogFn = (message: string, ...args: unknown[]) => void;

/** A logger with a fixed namespaced prefix. */
interface Logger {
  warn: LogFn;
  error: LogFn;
}

/**
 * Create a logger that prefixes every message with `[<name>] `.
 * e.g. createLogger("MeasureControl").warn("export failed:", err)
 * → console.warn("[MeasureControl] export failed:", err)
 */
const createLogger = (name: string): Logger => {
  return {
    warn: (message, ...args) => console.warn(msg(name, message, " "), ...args),
    error: (message, ...args) => console.error(msg(name, message, " "), ...args),
  };
};

/**
 * Wrap a native Error constructor in one that namespaces every message.
 * Used where the error value is *stored* rather than thrown immediately — the
 * LayerRegistry Proxy traps return a closure that throws later, so they cannot
 * call `fail` at setup time.
 *
 * Returns a real class extending the native constructor. An arrow wrapper like
 * `(message) => new TypeError(...)` would satisfy the `new` call signature but
 * hand the caller a plain function — `.message`, `.name` and `.stack` would
 * all be undefined, and `instanceof` would fail.
 */
const makeError = (
  ctor: new (message: string) => Error,
  name: string,
): new (message: string) => Error => {
  return class NamespacedError extends ctor {
    constructor(message: string) {
      super(msg(name, message, ": "));
    }
  };
};

/** A `TypeError` constructor that namespaces every message. */
const makeTypeError = (name: string): new (message: string) => TypeError => {
  return makeError(TypeError, name);
};

/**
 * Throw a namespaced error using a caller-supplied native constructor, so the
 * thrown value's own constructor is preserved: `catch (e) { if (e instanceof
 * TypeError) ... }` and class-name reporting keep working.
 *
 * The constructor is passed as a value rather than inferred, because a
 * wrapper that called `new Error(...)` for every site would silently downgrade
 * `TypeError` sites to `Error` and break those guards.
 */
const fail = (
  ctor: new (message: string) => Error,
  name: string,
  message: string,
): never => {
  return throwMsg(new ctor(msg(name, message, ": ")));
};

/** Throw a namespaced `Error`. */
const failError = (name: string, message: string): never => {
  return fail(Error, name, message);
};

/** Throw a namespaced `TypeError`. */
const failType = (name: string, message: string): never => {
  return fail(TypeError, name, message);
};

/**
 * Throw a constructed error. Its own body is unreachable, so the error value is
 * `return`ed instead — arrow bodies of type `never` may not fall off the end,
 * and returning preserves control-flow narrowing for callers that `return` it.
 */
const throwMsg = (error: Error): never => {
  throw error;
};

export {
  createLogger,
  fail,
  failError,
  failType,
  makeError,
  makeTypeError,
  type LogFn,
  type Logger,
};
