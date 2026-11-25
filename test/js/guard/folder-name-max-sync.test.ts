// script/check/folder-name-max-sync — the folder-name bound twin guard.
//
// foliplus/_declaration/key.py and foliplus/js/core/layer/folderLayout.ts each carry
// FOLDER_NAME_MAX as a hand-written number. The Python bound rejects an
// over-long folder name at declaration time; the JS bound prices row layout and
// truncation. If one side changed the number and the other stayed, a folder name
// Python accepts would be truncated (or rejected) by JS — the two channels would
// disagree about the same folder. This guard pins the two numbers to each other.
//
// Tree guard, not a script module: registered under NON_MODULE_TEST_SUBJECTS
// as check/folder-name-max-sync.
import { assertCrossLangLiteral, extractLiteral } from "./crossLangLiteral.js";
import { describe, expect, it } from "vitest";

const PY_DECL = "foliplus/_declaration/key.py";
const JS_LAYOUT = "foliplus/js/core/layer/folderLayout.ts";

/** Pull FOLDER_NAME_MAX out of the Python assignment. */
const pyFolderNameMax = (): string =>
  extractLiteral(PY_DECL, /FOLDER_NAME_MAX\s*=\s*(\d+)/);

/** Pull FOLDER_NAME_MAX out of the JS const declaration. */
const jsFolderNameMax = (): string =>
  extractLiteral(JS_LAYOUT, /FOLDER_NAME_MAX\s*=\s*(\d+)/);

describe("folder-name bound stays in step across Python and JS", () => {
  it("carries the same FOLDER_NAME_MAX number on both sides", () => {
    assertCrossLangLiteral(pyFolderNameMax(), jsFolderNameMax(), "FOLDER_NAME_MAX");
    // And the shared bound is the value both channels actually enforce — a
    // change to it is a real contract change that must be mirrored.
    expect(pyFolderNameMax()).toBe("64");
  });
});
