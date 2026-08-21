import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

vi.mock("../../queues/review.queue", () => ({
    reviewQueue: {
        add: vi.fn().mockResolvedValue({ id: "job-1", name: "review-pr" }),
    },
}));

import { webhookRequestHandler } from "./github.controller";
import { reviewQueue } from "../../queues/review.queue";

const SECRET = process.env.GITHUB_WEBHOOK_SECRET as string;

function buildRequest(payload: Record<string, unknown>) {
    const body = Buffer.from(JSON.stringify(payload));
    const digest = crypto.createHmac("sha256", SECRET).update(body).digest("hex");

    return {
        requestId: "req-123",
        body,
        header: (name: string) =>
            name === "X-Hub-Signature-256" ? `sha256=${digest}` : undefined,
    } as any;
}

function buildResponse(): any {
    const res = {
        status: vi.fn(() => res),
        json: vi.fn(),
    };
    return res;
}

function webhookPayload(action: string) {
    return {
        action,
        repository: { full_name: "toji/repo" },
        pull_request: { number: 7, head: { sha: "abc" } },
        sender: { login: "toji" },
        changes: "",
    };
}

describe("webhookRequestHandler", () => {
    beforeEach(() => {
        vi.mocked(reviewQueue.add).mockClear();
    });

    it("returns 401 for an invalid signature", async () => {
        const req = {
            requestId: "req-1",
            body: Buffer.from(JSON.stringify(webhookPayload("opened"))),
            header: () => "sha256=wrong",
        } as any;
        const res = buildResponse();

        await webhookRequestHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    it("returns 401 for a missing signature header", async () => {
        const req = {
            requestId: "req-1",
            body: Buffer.from(JSON.stringify(webhookPayload("opened"))),
            header: () => undefined,
        } as any;
        const res = buildResponse();

        await webhookRequestHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    it("queues a review job for a valid opened event", async () => {
        const res = buildResponse();

        await webhookRequestHandler(buildRequest(webhookPayload("opened")), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(reviewQueue.add).toHaveBeenCalledWith("review-pr", {
            requestId: "req-123",
            repository: "toji/repo",
            prNumber: 7,
            sha: "abc",
        });
    });

    it("queues a review job for a synchronize event", async () => {
        const res = buildResponse();

        await webhookRequestHandler(buildRequest(webhookPayload("synchronize")), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(reviewQueue.add).toHaveBeenCalledTimes(1);
    });

    it("ignores edited and closed events", async () => {
        for (const action of ["edited", "closed"]) {
            vi.mocked(reviewQueue.add).mockClear();
            const res = buildResponse();

            await webhookRequestHandler(buildRequest(webhookPayload(action)), res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(reviewQueue.add).not.toHaveBeenCalled();
        }
    });
});