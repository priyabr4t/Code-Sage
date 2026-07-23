import { Request } from "express";
import crypto from "node:crypto";
import { env } from "../../config/env"
export const verifyGithubSignature = (req: Request): boolean => {

    console.log("Request body:", req.body instanceof Buffer);
    console.log("Type of request body:", typeof req.body);

    const signature = req.header("X-Hub-Signature-256");

    if (!signature) {
        return false;
    }
    if (!Buffer.isBuffer(req.body)) {
        return false;
    }

    const payload = req.body as Buffer;

    console.log("payload -> ", payload)

    const digest = "sha256=" +
        crypto
            .createHmac('sha256', env.GITHUB_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');
    console.log("Payload:");
    console.log(payload.toString());

    console.log("Digest:");
    console.log(digest);
    if (digest.length !== signature.length) {
        return false;
    }
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(digest)
    );
}

