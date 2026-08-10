import { logger } from "../../shared/logger";
import { ReviewIssue } from "./parser.types";
import { z } from "zod";

const reviewIssueSchema = z.object({
    filename: z.string().min(1),
    line: z.number().int(),
    explanation: z.string().min(1),
    suggestedFix: z.string().optional().default(""),
});

const reviewSchema = z.array(reviewIssueSchema);

export const parseReview = (response: string): ReviewIssue[] => {
    const cleaned = response
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

    try {
        const parsed = JSON.parse(cleaned);

        if (!Array.isArray(parsed)) {
            logger.warn("Invalid AI response: expected a JSON array");
            return [];
        }

        const result = reviewSchema.safeParse(parsed);

        if (!result.success) {
            logger.warn(
                {
                    errors: result.error.issues,
                },
                "Invalid AI response: schema validation failed"
            );
            return [];
        }

        return result.data;
    } catch {
        logger.warn("Invalid AI response");
        return [];
    }
};