import { ReviewIssue } from "./parser.types";

export const parseReview = (
    response: string
): ReviewIssue[] => {
    return JSON.parse(response);
};