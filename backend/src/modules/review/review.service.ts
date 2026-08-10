import { RestEndpointMethodTypes } from "@octokit/rest";
import { ReviewFile } from "./review.types";
import { parsePatch } from "./patch-parser";
import { ReviewIssue } from "../ai/parser.types";

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

export function filterReviewIssues(
    issues: ReviewIssue[],
    files: ReviewFile[]
): { valid: ReviewIssue[]; filtered: ReviewIssue[] } {
    const changedLinesByFile = new Map<string, Set<number>>();

    for (const file of files) {
        changedLinesByFile.set(
            file.filename,
            new Set(file.changedLines.map(line => line.line))
        );
    }

    const valid: ReviewIssue[] = [];
    const filtered: ReviewIssue[] = [];

    for (const issue of issues) {
        const changedLines = changedLinesByFile.get(issue.filename);

        if (!changedLines || !changedLines.has(issue.line)) {
            filtered.push(issue);
            continue;
        }

        valid.push(issue);
    }

    return { valid, filtered };
}