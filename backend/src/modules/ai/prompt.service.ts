import { ReviewFile } from "../review/review.types";
import { ReviewContext } from "./prompt.types";

function buildSystemInstructions(): string {
    return `You are an experienced senior software engineer.

Review the following pull request.

Focus on:
- Bugs
- Security issues
- Performance
- Maintainability
- Best practices

Do not comment on formatting or code style unless it affects correctness.

`;
}

function buildPullRequestSection(context: ReviewContext): string {
    return `Title:
${context.title}

Description:
${context.description}

`;
}

function buildOutputInstructions(): string {
    return `Return the review as a list of issues.

For each issue include:
- filename
- explanation
- suggested fix
`;
}

function buildFilesSection(files: ReviewFile[]): string {
    let section = "";

    for (const file of files) {
        section += `----------------------------------------

File:
${file.filename}

Patch:
${file.patch}

`;
    }

    return section;
}


export const buildReviewPrompt = (
    context: ReviewContext
): string => {
    let prompt = "";

    prompt += buildSystemInstructions();
    prompt += buildPullRequestSection(context);
    prompt += buildFilesSection(context.files);
    prompt += buildOutputInstructions();

    return prompt;
}