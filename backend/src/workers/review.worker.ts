import "dotenv/config";
import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { logger } from "../shared/logger";

new Worker(
    "review-queue",
    async (job) => {
        logger.info(
            {
                id: job.id,
                data: job.data,
            },
            "Processing review job"
        );
    },
    {
        connection: redisConnection,
    }
);