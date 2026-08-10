import "dotenv/config";
import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { logger } from "../shared/logger";
import {
    getPullRequest,
    getPullRequestFiles,
} from "../modules/github/github.service";
import { filterReviewIssues, prepareReviewFiles } from "../modules/review/review.service";
import { buildReviewPrompt } from "../modules/ai/prompt.service";
import { generateReview } from "../modules/ai/ai.service";
import { createReview } from "../modules/github/review.service";
import { ReviewIssue } from "../modules/ai/parser.types";

function buildReviewSummary(issues: ReviewIssue[]): string {
    const countByFile = new Map<string, number>();

    for (const issue of issues) {
        countByFile.set(
            issue.filename,
            (countByFile.get(issue.filename) ?? 0) + 1
        );
    }

    const perFile = [...countByFile.entries()]
        .map(([filename, count]) => `- ${filename}: ${count}`)
        .join("\n");

    return [
        `CodeSage found ${issues.length} actionable issue(s) in this pull request.`,
        "",
        "Issues by file:",
        perFile,
    ].join("\n");
}

new Worker(
    "review-queue",
    async (job) => {
        const { requestId, repository, prNumber, sha } = job.data;

        const [owner, repo] = repository.split("/");
        if (!owner || !repo) {
            throw new Error(`Invalid repository format: ${repository}`);
        }

        try {
            const pullRequest = await getPullRequest(
                owner,
                repo,
                prNumber
            );

            logger.info(
                {
                    requestId,
                    title: pullRequest.title,
                    state: pullRequest.state,
                    author: pullRequest.user.login,
                },
                "Pull request fetched"
            );

            const files = await getPullRequestFiles(
                owner,
                repo,
                prNumber
            );

            logger.info(
                {
                    totalFiles: files.length,
                },
                "Fetched changed files"
            );

            const reviewFiles = prepareReviewFiles(files)

            logger.info(
                {
                    totalReviewFiles: reviewFiles.length,
                },
                "Prepared review files"
            );

            const prompt = buildReviewPrompt({
                title: pullRequest.title,
                description: pullRequest.body ?? "",
                files: reviewFiles
            })

            const review = await generateReview(prompt)

            logger.info(
                {
                    issueCount: review.length,
                },
                "AI Review Generated"
            );

            const { valid, filtered } = filterReviewIssues(
                review,
                reviewFiles
            );

            if (filtered.length > 0) {
                logger.warn(
                    {
                        requestId,
                        filtered: filtered.map(issue =>
                            `${issue.filename}:${issue.line}`
                        ),
                    },
                    "Filtered out issues not on changed lines"
                );
            }

            if (valid.length === 0) {
                logger.info(
                    {
                        requestId,
                    },
                    "No actionable issues found, skipping review post"
                );

                return;
            }

            const summary = buildReviewSummary(valid);

            await createReview(
                owner,
                repo,
                prNumber,
                sha,
                valid,
                summary
            );

            logger.info(
                {
                    requestId,
                    commentCount: valid.length,
                },
                "Review posted"
            );

        } catch (error) {
            logger.error(
                {
                    err: error,
                    jobId: job.id,
                    requestId,
                    repository,
                    prNumber,
                },
                "Failed to process review job"
            );
            throw error
        }
    },
    {
        connection: redisConnection,
    }
);