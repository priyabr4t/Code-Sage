import { ReviewIssue } from "./parser.types";

export const parseReview = (response: string): ReviewIssue[] => {
    const cleaned = response
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

    return JSON.parse(cleaned);
};
