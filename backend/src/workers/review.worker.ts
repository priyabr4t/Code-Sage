import "dotenv/config";
import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { logger } from "../shared/logger";
import { getPullRequest } from "../modules/github/github.service";

new Worker(
    "review-queue",
    async (job) => {
        const {repository, prNumber} = job.data()
        const [owner, repo] = repository.split("/")

        const pullRequest = await getPullRequest(
            owner, 
            repo,
            prNumber
        )

        logger.info(
            {
                title: pullRequest.title,
                state: pullRequest.state,
                author: pullRequest.user.login
            },
            "Processing review job"
        );
    },
    {
        connection: redisConnection,
    }
);