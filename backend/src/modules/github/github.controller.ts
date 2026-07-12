import { Request, Response } from 'express';
import { verifyGithubSignature } from './verifyGithubSignature';
import { logger } from '../../shared/logger';
import { PullRequestWebhookPayload } from './gthub.types';
import { reviewQueue } from '../../queues/review.queue';

export const webhookRequestHandler = async (req: Request, res: Response) => {
    logger.info(
        { requestId: req.requestId },
        "Webhook received"
    );

    if (!verifyGithubSignature(req)) {
        return res.status(401).json({
            message: "Invalid signature",
        });
    }

    const payload: PullRequestWebhookPayload = JSON.parse(req.body.toString());

    const { action, repository, pull_request } = payload;

    // avoid unsupported action types
    if (action !== "opened" && action !== "synchronize") {
        logger.info({
            requestId: req.requestId,
            action: action,
        }, "Unsupported action type received");

        return res.status(200).json({ ignored: true });
    }

    logger.info(
        {
            requestId: req.requestId,
            action,
            repository: repository.full_name,
            prNumber: pull_request.number,
        },
        "Pull request parsed"
    );
    await reviewQueue.add("review-pr", {
        requestId: req.requestId,
        repository: repository.full_name,
        prNumber: pull_request.number,
        sha: pull_request.head.sha,
    });

    logger.info(
        {
            requestId: req.requestId,
            jobName: "review-pr",
        },
        "Review job queued"
    );

    return res.status(200).json({
        queued: true,
    });

}
