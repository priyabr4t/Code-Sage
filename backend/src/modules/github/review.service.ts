import { github } from "../../lib/github";
import { ReviewIssue } from "../ai/parser.types";
import { logger } from "../../shared/logger";

export async function createReview(
    owner: string,
    repo: string,
    pullNumber: number,
    commitId: string,
    issues: ReviewIssue[],
    summary: string
) {
    const comments = issues.map(issue => ({
        path: issue.filename,
        line: issue.line,
        side: "RIGHT" as const,
        body:
            `### ${issue.explanation}\n\n` +
            (issue.suggestedFix
                ? `**Suggested Fix:**\n${issue.suggestedFix}`
                : ""),
    }));

    await github.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: commitId,
        event: "COMMENT",
        body: summary,
        comments,
    });

    logger.info(
        {
            owner,
            repo,
            pullNumber,
            commentCount: comments.length,
        },
        "Review posted to GitHub"
    );
}