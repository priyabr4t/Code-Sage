import { github } from "../../lib/github";
import { ReviewIssue } from "../ai/parser.types";

export async function createReview(
    owner: string,
    repo: string,
    pullNumber: number,
    commitId: string,
    issues: ReviewIssue[]
) {
    await github.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: commitId,
        event: "COMMENT",
        body: issues
            .map(issue =>
                `### ${issue.filename}

                ${issue.explanation}

                Suggested Fix:
                ${issue.suggestedFix}`
            )
            .join("\n\n---\n\n"),
    });
}