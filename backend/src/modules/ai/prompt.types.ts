import { ReviewFile } from "../review/review.types";

export interface ReviewContext {
    title: string;
    description: string;
    files: ReviewFile[];
}