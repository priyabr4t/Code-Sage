import { ai } from "./ai.client";
import { logger } from "../../shared/logger";
import { ReviewIssue } from "./parser.types";
import { parseReview } from "./parser";

export const generateReview = async (prompt: string): Promise<ReviewIssue[]> => {
    try {

        logger.info(
            {
                promptLength: prompt.length
            },
            "Sending review request to Gemini"
        )

        const response = await ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: prompt,
        })

        const review = response.text ?? "";
        const issues = parseReview(review);

        logger.info(
            "Received Gemini response"
        )

        return issues

    } catch (error) {

        logger.error(
            {
                err: error,
            },
            "Failed to generate AI review"
        );

        throw error;
    }
}