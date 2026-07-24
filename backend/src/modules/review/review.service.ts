import { ReviewFile } from "./review.types";

export const prepareReviewFiles = (
    files: any[],

): ReviewFile[] => {
    const ignoredFiles = [
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
    ];
    const reviewFiles: ReviewFile[] = [];

    for (const file of files) {

        // skip files without patch
        if (!file.patch) continue;

        // skip generated lock files
        if (
            ignoredFiles.some((ignoredFile) =>
                file.filename.endsWith(ignoredFile)
            )
        ) {
            continue;
        }
        reviewFiles.push({
            filename: file.filename,
            patch: file.patch
        })
    }

    return reviewFiles
}