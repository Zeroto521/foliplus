// test/js/guard/jsSource — string-aware JS comment stripping for the source guards
//
// A regex `//[^\n]*` strip treats the `//` inside `"http://x"` as a comment
// and deletes the rest of that line — including a real `CONFIG.field` read
// after the string. These guards scan source for reads, so they need the JS
// lexer rule: comments are comments only outside string/template literals.
// Newlines are preserved so line numbers stay meaningful for reports.

/** Replace line/block comments with spaces, keeping string literals intact. */
const codeOnly = (src: string): string => {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < src.length) {
        const c = src[i];
        out += c;
        i += 1;
        if (c === "\\" && i < src.length) {
          out += src[i];
          i += 1;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
};

export { codeOnly };
