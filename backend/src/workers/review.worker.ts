import "dotenv/config";
import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { logger } from "../shared/logger";
import {
    getPullRequest,
    getPullRequestFiles,
} from "../modules/github/github.service";
import { prepareReviewFiles } from "../modules/review/review.service";

new Worker(
    "review-queue",
    async (job) => {
        const { requestId, repository, prNumber } = job.data;

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



            for (const file of reviewFiles) {
                logger.info({
                    filename: file.filename,
                    patch: file.patch,
                });
            }
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
        }
    },
    {
        connection: redisConnection,
    }
);