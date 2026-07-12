import { Queue } from "bullmq";
import { redisConnection } from "../lib/redis";

export const reviewQueue = new Queue("review-queue", {
    connection: redisConnection,
});