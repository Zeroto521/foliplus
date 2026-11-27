// core/layer/folderName — the folder-name pure functions (single home).
//
// A folder name is a short label read on a list row; the functions here own the
// NFC/whitespace/case folding, the code-point length, and the length cap. They
// were extracted from the folder-layout domain so name logic has one home.
import { describe, expect, it } from "vitest";
import {
  FOLDER_NAME_MAX,
  folderDisplayName,
  folderNameLength,
  folderNameTooLong,
  normalizeFolderName,
} from "#core/layer/index.js";

describe("normalizeFolderName", () => {
  it("folds NFC, whitespace and case", () => {
    expect(normalizeFolderName("  Roads\tRoads  ")).toBe("roads roads");
    expect(normalizeFolderName("ROADS")).toBe("roads");
    expect(normalizeFolderName("  roads ")).toBe("roads");
  });
});

describe("folderDisplayName", () => {
  it("trims the display name (the row label is never whitespace-padded)", () => {
    expect(folderDisplayName("  Roads  ")).toBe("Roads");
    expect(folderDisplayName("")).toBe("");
  });
});

describe("folderNameLength", () => {
  it("folds NFC, collapses whitespace, trims, counts code points", () => {
    expect(folderNameLength("e\u0301")).toBe(1);
    expect(folderNameLength("  Roads\tRoads  ")).toBe(11);
    expect(folderNameLength("\u{1F600}")).toBe(1);
    expect(folderNameLength("")).toBe(0);
  });
});

describe("folderNameTooLong", () => {
  it("is the single cap decision point", () => {
    const atMax = "a".repeat(FOLDER_NAME_MAX);
    expect(folderNameTooLong(atMax)).toBe(false);
    expect(folderNameTooLong(`${atMax}b`)).toBe(true);
  });
});
