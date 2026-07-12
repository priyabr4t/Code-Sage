import { env } from "../config/env";

export const redisConnection = {
    url: env.REDIS_URL,
};