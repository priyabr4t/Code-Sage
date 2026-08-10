import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/github", () => ({
    github: {
        pulls: {
            createReview: vi.fn().mockResolvedValue({}),
        },
    },
}));

import { github } from "../../lib/github";
import { createReview } from "./review.service";

describe("createReview", () => {
    const issues = [
        {
            filename: "src/a.ts",
            line: 12,
            explanation: "Possible null deref",
            suggestedFix: "Add a guard.",
        },
        {
            filename: "src/a.ts",
            line: 15,
            explanation: "Slow loop",
            suggestedFix: "",
        },
    ];

    beforeEach(() => {
        vi.mocked(github.pulls.createReview).mockClear();
    });

    it("posts inline comments together with the summary body", async () => {
        await createReview(
            "toji",
            "repos",
            42,
            "sha123",
            issues,
            "Summary text"
        );

        expect(github.pulls.createReview).toHaveBeenCalledTimes(1);
        expect(github.pulls.createReview).toHaveBeenCalledWith({
            owner: "toji",
            repo: "repos",
            pull_number: 42,
            commit_id: "sha123",
            event: "COMMENT",
            body: "Summary text",
            comments: [
                {
                    path: "src/a.ts",
                    line: 12,
                    side: "RIGHT",
                    body: "### Possible null deref\n\n**Suggested Fix:**\nAdd a guard.",
                },
                {
                    path: "src/a.ts",
                    line: 15,
                    side: "RIGHT",
                    body: "### Slow loop\n\n",
                },
            ],
        });
    });

    it("posts an empty comments array for no issues", async () => {
        await createReview("toji", "repos", 42, "sha123", [], "No issues");

        expect(github.pulls.createReview).toHaveBeenCalledWith(
            expect.objectContaining({ comments: [] })
        );
    });
});