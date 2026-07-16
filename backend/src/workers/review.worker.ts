import "dotenv/config";
import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { logger } from "../shared/logger";
import { getPullRequest, getPullRequestFiles } from "../modules/github/github.service";
import { file } from "zod";

new Worker(
    "review-queue",
    async (job) => {
        const { repository, prNumber } = job.data()
        const [owner, repo] = repository.split("/")

        const pullRequest = await getPullRequest(
            owner,
            repo,
            prNumber
        )

        const files = await getPullRequestFiles(
            owner,
            repo,
            prNumber
        )

        logger.info({
            totalFiles: files.length,
        }, " Fetched changed files"
        )

        for(const file of files){
            logger.info({
                filename: file.filename,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions
            })
        }
    },
    {
        connection: redisConnection,
    }
);