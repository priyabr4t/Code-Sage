import { describe, expect, it } from "vitest";
import { filterReviewIssues } from "./review.service";
import { ReviewFile } from "./review.types";

function file(filename: string, lines: number[]): ReviewFile {
    return {
        filename,
        patch: "",
        changedLines: lines.map(line => ({ line, code: "code" })),
    };
}

describe("filterReviewIssues", () => {
    const files = [
        file("src/a.ts", [12, 13]),
        file("src/b.ts", [5]),
    ];

    it("keeps issues that point at changed lines", () => {
        const issues = [
            { filename: "src/a.ts", line: 12, explanation: "x", suggestedFix: "y" },
        ];

        const { valid, filtered } = filterReviewIssues(issues, files);

        expect(valid).toEqual(issues);
        expect(filtered).toEqual([]);
    });

    it("filters out issues on unmodified lines", () => {
        const issues = [
            { filename: "src/a.ts", line: 99, explanation: "x", suggestedFix: "y" },
        ];

        const { valid, filtered } = filterReviewIssues(issues, files);

        expect(valid).toEqual([]);
        expect(filtered).toEqual(issues);
    });

    it("filters out issues for unknown files", () => {
        const issues = [
            { filename: "src/missing.ts", line: 1, explanation: "x", suggestedFix: "y" },
        ];

        const { valid, filtered } = filterReviewIssues(issues, files);

        expect(valid).toEqual([]);
        expect(filtered).toEqual(issues);
    });

    it("splits a mixed set into valid and filtered", () => {
        const good = { filename: "src/b.ts", line: 5, explanation: "x", suggestedFix: "y" };
        const bad = { filename: "src/b.ts", line: 6, explanation: "x", suggestedFix: "y" };

        const { valid, filtered } = filterReviewIssues([good, bad], files);

        expect(valid).toEqual([good]);
        expect(filtered).toEqual([bad]);
    });
});