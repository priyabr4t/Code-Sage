import { describe, expect, it } from "vitest";
import { parsePatch } from "./patch-parser";

describe("parsePatch", () => {
    it("extracts added lines with their new line numbers", () => {
        const patch = [
            "@@ -1,3 +1,4 @@",
            " line1",
            "+line2",
            " line3",
            "+line4",
        ].join("\n");

        expect(parsePatch(patch)).toEqual([
            { line: 2, code: "line2" },
            { line: 4, code: "line4" },
        ]);
    });

    it("handles multiple hunks by resetting the line counter", () => {
        const patch = [
            "@@ -1,2 +1,2 @@",
            " a",
            " b",
            "@@ -10,1 +11,1 @@",
            "+added",
        ].join("\n");

        expect(parsePatch(patch)).toEqual([{ line: 11, code: "added" }]);
    });

    it("handles a hunk header with a start line and range", () => {
        const patch = [
            "@@ -50,12 +60,15 @@",
            "+x",
        ].join("\n");

        expect(parsePatch(patch)).toEqual([{ line: 60, code: "x" }]);
    });

    it("does not count deleted lines as changed lines", () => {
        const patch = [
            "@@ -1,2 +1,1 @@",
            " keep",
            "-remove",
        ].join("\n");

        expect(parsePatch(patch)).toEqual([]);
    });

    it("ignores file header lines (--- and +++)", () => {
        const patch = [
            "--- a/src/a.ts",
            "+++ b/src/a.ts",
            "@@ -1,1 +1,1 @@",
            "+changed",
        ].join("\n");

        expect(parsePatch(patch)).toEqual([{ line: 1, code: "changed" }]);
    });

    it("tracks context lines that follow an addition", () => {
        const patch = [
            "@@ -5,3 +5,4 @@",
            "+x",
            " context",
            "+y",
        ].join("\n");

        expect(parsePatch(patch)).toEqual([
            { line: 5, code: "x" },
            { line: 7, code: "y" },
        ]);
    });

    it("returns an empty array for an empty patch", () => {
        expect(parsePatch("")).toEqual([]);
    });
});