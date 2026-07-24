import { Request } from "express";
import crypto from "node:crypto";
import { env } from "../../config/env"
export const verifyGithubSignature = (req: Request): boolean => {

    const signature = req.header("X-Hub-Signature-256");

    if (!signature) {
        return false;
    }
    if (!Buffer.isBuffer(req.body)) {
        return false;
    }

    const payload = req.body as Buffer;

    const digest = "sha256=" +
        crypto
            .createHmac('sha256', env.GITHUB_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');

    if (digest.length !== signature.length) {
        return false;
    }
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(digest)
    );
}

