import { RestEndpointMethodTypes } from "@octokit/rest";
import { ReviewFile } from "./review.types";
import { parsePatch } from "./patch-parser";

type PullRequestFile = RestEndpointMethodTypes["pulls"]["listFiles"]["response"]["data"][number];

export function prepareReviewFiles(files: PullRequestFile[]): ReviewFile[] {
    return files
        .filter((file) => file.patch)
        .map((file) => {
            const patch = file.patch!;

            return {
                filename: file.filename,
                patch,
                changedLines: parsePatch(patch),
            };
        });
}