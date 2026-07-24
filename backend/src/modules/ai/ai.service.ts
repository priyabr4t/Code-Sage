import { ai } from "./ai.client";
import { logger } from "../../shared/logger";

export const generateReview = async (prompt: string): Promise<string> => {
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

        logger.info(
            {
                responseLength: review.length,
            },
            "Received Gemini response"
        )

        return review

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