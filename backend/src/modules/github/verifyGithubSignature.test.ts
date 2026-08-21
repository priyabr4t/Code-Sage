import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyGithubSignature } from "./verifyGithubSignature";

const SECRET = process.env.GITHUB_WEBHOOK_SECRET as string;

function makeReq(payload: Buffer, signature?: string) {
    return {
        header: (name: string) =>
            name === "X-Hub-Signature-256" ? signature : undefined,
        body: payload,
    } as any;
}

describe("verifyGithubSignature", () => {
    const payload = Buffer.from('{"ok":true}');

    it("accepts a valid signature", () => {
        const digest = crypto
            .createHmac("sha256", SECRET)
            .update(payload)
            .digest("hex");

        expect(verifyGithubSignature(makeReq(payload, `sha256=${digest}`))).toBe(true);
    });

    it("rejects a tampered signature", () => {
        expect(verifyGithubSignature(makeReq(payload, "sha256=deadbeef"))).toBe(false);
    });

    it("rejects a signature with the wrong length", () => {
        expect(verifyGithubSignature(makeReq(payload, "sha256=short"))).toBe(false);
    });

    it("rejects a missing signature header", () => {
        expect(verifyGithubSignature(makeReq(payload))).toBe(false);
    });

    it("rejects a non-buffer body", () => {
        const req = {
            header: () => "sha256=abcdef",
            body: '{"ok":true}',
        } as any;

        expect(verifyGithubSignature(req)).toBe(false);
    });
});