import { Request, Response } from 'express';
import { verifyGithubSignature } from './verifyGithubSignature';
import { logger } from '../../shared/logger';
import { PullRequestWebhookPayload } from './gthub.types';

export const webhookRequestHandler = (req: Request, res: Response) => {
    logger.info({
        requestId: req.requestId,
        message: "Received webhook request",
    }, "Webhook received");

    if (!verifyGithubSignature(req)) {
        return res.status(401).json({
            message: "Invalid signature",
        });
    }

    const payload: PullRequestWebhookPayload = JSON.parse(req.body.toString());

    const { action, repository, pull_request } = payload;

    // avoid unsupported action types
    if(action !== "opened" && action !== "synchronize" ) {
        logger.info({
            requestId: req.requestId,
            action: action,
        }, "Unsupported action type received");

        return res.status(200).json({ ignored: true });
    }

    logger.info({
        requestId: req.requestId,
        action: action,
        repository: repository?.full_name,
        pull_request_number: pull_request?.number,
    }, "Pull request payload received");

    const githubEvent = req.header("X-GitHub-Event");
    const deliveryId = req.header("X-GitHub-Delivery");

    logger.info({
        requestId: req.requestId,
        event: githubEvent,
        deliveryId: deliveryId,
    }, "signature verified and payload parsed successfully");

    return res.status(200).json({ received: true });
}
