import { logger } from "../../shared/logger";
import { ReviewIssue } from "./parser.types";

export const parseReview = (response: string): ReviewIssue[] => {
    const cleaned = response
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        logger.warn("Invalid AI response");
        return [];
    }
};
