import { ReviewFile } from "./review.types";

export const prepareReviewFiles = (
    files: any[],

): ReviewFile[] => {
    const reviewFiles: ReviewFile[] = [];

    for (const file of files) {

        // skip files without patch
        if (!file.patch) continue;

        reviewFiles.push({
            filename: file.filename,
            patch: file.patch
        })
    }

    return reviewFiles
}