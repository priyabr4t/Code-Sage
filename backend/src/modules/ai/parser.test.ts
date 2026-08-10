import { describe, expect, it } from "vitest";
import { parseReview } from "./parser";

describe("parseReview", () => {
    const issue = {
        filename: "src/a.ts",
        line: 12,
        explanation: "Foo",
        suggestedFix: "Bar",
    };

    it("parses a valid JSON array", () => {
        expect(parseReview(JSON.stringify([issue]))).toEqual([issue]);
    });

    it("parses a markdown-wrapped JSON array", () => {
        const wrapped = "```json\n" + JSON.stringify([issue]) + "\n```";
        expect(parseReview(wrapped)).toEqual([issue]);
    });

    it("defaults a missing suggestedFix to an empty string", () => {
        const minimal = {
            filename: "src/a.ts",
            line: 12,
            explanation: "Foo",
        };

        expect(parseReview(JSON.stringify([minimal]))).toEqual([
            { ...minimal, suggestedFix: "" },
        ]);
    });

    it("strips unknown fields from an issue", () => {
        const withExtra = {
            ...issue,
            severity: "critical",
        };

        expect(parseReview(JSON.stringify([withExtra]))).toEqual([issue]);
    });

    it("returns [] for invalid JSON", () => {
        expect(parseReview("not json")).toEqual([]);
    });

    it("returns [] for a non-array JSON object", () => {
        expect(parseReview(JSON.stringify({ foo: "bar" }))).toEqual([]);
    });

    it("returns [] if any issue is malformed", () => {
        const malformed = [{ filename: "src/a.ts", line: 12 }];
        expect(parseReview(JSON.stringify(malformed))).toEqual([]);
    });

    it("returns [] for a non-numeric line", () => {
        const badLine = { ...issue, line: "12" };
        expect(parseReview(JSON.stringify([badLine]))).toEqual([]);
    });
});