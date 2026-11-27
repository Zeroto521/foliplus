// core/order/rank — fractional order keys for sibling order (fractional-indexing).
//
// A rank is a base62-char string such as "a0", "a0V", "a1". Sibling order is
// the plain lexicographic order of ranks. rankBetween(a, b) returns a key strictly
// between two neighbours (either may be null for an unbounded side); rankAfter(a)
// appends after the last rank; rankStart() is the first key. Repeated inserts into
// the same gap grow the key only logarithmically (no renumber, no splice).
//
// This is a faithful port of rocicorp/fractional-indexing (CC0-1.0), trimmed of the
// caches and the multi-key generator; the integer-part head/digit structure and the
// ordering guarantee are identical.
import { ALPHABET } from "./alphabet.js";

// digits: fractional-digit alphabet (base62). intDigits: head alphabet (A-Za-z,
// even length; first half negative-length heads, second half positive-length heads).
const DIGITS = ALPHABET;
const INT_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const digitIndex = new Map<string, number>();
for (let i = 0; i < DIGITS.length; i += 1) digitIndex.set(DIGITS[i], i);
const intIndex = new Map<string, number>();
for (let i = 0; i < INT_DIGITS.length; i += 1) intIndex.set(INT_DIGITS[i], i);

/** The first (smallest) rank. */
export const rankStart = (): string => "a0";

/** A rank strictly greater than `a` (insert after the last rank). */
export const rankAfter = (a: string): string => generateKeyBetween(a, null);

/** The rank of the FIRST child when a parent has no children yet. */
export const rankFirst = (): string => rankStart();

/** A rank strictly between `a` and `b` (either may be null for an unbounded side). */
export const rankBetween = (a: string | null, b: string | null): string =>
  generateKeyBetween(a, b);

/* ---- fractional-indexing internals (ported) ---- */

const at = (map: Map<string, number>, c: string): number => map.get(c) as number;

function midpoint(a: string, b: string | null): string {
  const zero = DIGITS[0];
  if (b != null && a >= b) throw new Error(a + " >= " + b);
  if (a.slice(-1) === zero || (b != null && b.slice(-1) === zero)) {
    throw new Error("trailing zero");
  }
  if (b != null) {
    let n = 0;
    while ((a[n] || zero) === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? at(digitIndex, a[0]) : 0;
  const digitB = b != null ? at(digitIndex, b[0]) : DIGITS.length;
  if (digitB - digitA > 1) {
    const midDigit = Math.round(0.5 * (digitA + digitB));
    return DIGITS[midDigit];
  } else {
    if (b != null && b.length > 1) return b.slice(0, 1);
    return DIGITS[digitA] + midpoint(a.slice(1), null);
  }
}

function getIntegerLength(head: string): number {
  const i = at(intIndex, head);
  const half = INT_DIGITS.length / 2;
  return i < half ? half - i + 1 : i - half + 2;
}

function getIntegerPart(key: string): string {
  const len = getIntegerLength(key[0]);
  if (len > key.length) throw new Error("invalid order key: " + key);
  return key.slice(0, len);
}

function validateInteger(x: string): void {
  if (x.length !== getIntegerLength(x[0])) {
    throw new Error("invalid integer part of order key: " + x);
  }
}

function isSmallestInteger(x: string): boolean {
  return x === INT_DIGITS[0] + DIGITS[0].repeat(INT_DIGITS.length / 2);
}

function validateOrderKey(key: string): void {
  if (isSmallestInteger(key)) throw new Error("invalid order key: " + key);
  const i = getIntegerPart(key);
  const f = key.slice(i.length);
  if (f.slice(-1) === DIGITS[0]) throw new Error("invalid order key: " + key);
}

function incrementInteger(x: string): string | null {
  validateInteger(x);
  const head = x[0];
  const zero = DIGITS[0];
  let trailing = "";
  for (let i = x.length - 1; i >= 1; i -= 1) {
    const d = at(digitIndex, x[i]) + 1;
    if (d === DIGITS.length) {
      trailing = zero + trailing;
    } else {
      return head + x.slice(1, i) + DIGITS[d] + trailing;
    }
  }
  const headIndex = at(intIndex, head);
  if (headIndex === INT_DIGITS.length - 1) return null;
  const h = INT_DIGITS[headIndex + 1];
  const lengthDelta = getIntegerLength(h) - getIntegerLength(head);
  return (
    h +
    (lengthDelta > 0 ? trailing + zero : lengthDelta < 0 ? trailing.slice(1) : trailing)
  );
}

function decrementInteger(x: string): string | null {
  validateInteger(x);
  const head = x[0];
  const last = DIGITS[DIGITS.length - 1];
  let trailing = "";
  for (let i = x.length - 1; i >= 1; i -= 1) {
    const d = at(digitIndex, x[i]) - 1;
    if (d === -1) {
      trailing = last + trailing;
    } else {
      return head + x.slice(1, i) + DIGITS[d] + trailing;
    }
  }
  const headIndex = at(intIndex, head);
  if (headIndex === 0) return null;
  const h = INT_DIGITS[headIndex - 1];
  const lengthDelta = getIntegerLength(h) - getIntegerLength(head);
  return (
    h +
    (lengthDelta > 0 ? trailing + last : lengthDelta < 0 ? trailing.slice(1) : trailing)
  );
}

/** Generate an order key strictly between `a` and `b` (either may be null). */
function generateKeyBetween(a: string | null, b: string | null): string {
  if (a != null) validateOrderKey(a);
  if (b != null) validateOrderKey(b);
  if (a != null && b != null && a > b) {
    const t = a;
    a = b;
    b = t;
  }

  if (a == null) {
    if (b == null) {
      const head = INT_DIGITS[INT_DIGITS.length / 2];
      return head + DIGITS[0];
    }
    const ib = getIntegerPart(b);
    const fb = b.slice(ib.length);
    if (isSmallestInteger(ib)) return ib + midpoint("", fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res == null) throw new Error("cannot decrement any more");
    return res;
  }

  if (b == null) {
    const ia = getIntegerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i == null ? ia + midpoint(fa, null) : i;
  }

  const ia = getIntegerPart(a);
  const fa = a.slice(ia.length);
  const ib = getIntegerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i == null) throw new Error("cannot increment any more");
  if (i < b) return i;
  return ia + midpoint(fa, null);
}
