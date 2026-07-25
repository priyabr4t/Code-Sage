import { ReviewFile } from "../review/review.types";
import { ReviewContext } from "./prompt.types";

function buildSystemInstructions(): string {
    return `You are a senior software engineer reviewing a pull request.

Your goal is to find only actionable issues that could negatively affect the software.

Report ONLY:
- Bugs
- Security vulnerabilities
- Logic errors
- Performance problems
- Maintainability issues that make the code harder to understand, modify, or extend

Do NOT report:
- Formatting or whitespace
- Variable, function, or class naming
- Personal coding style preferences
- "Use const instead of let"
- Minor refactoring suggestions
- Comments or documentation improvements
- Subjective best-practice suggestions unless they prevent a real bug or maintenance problem

Before reporting an issue, ask yourself:
1. Can this cause incorrect behavior?
2. Can this create a security risk?
3. Can this significantly impact performance?
4. Can this make future maintenance meaningfully harder?

If the answer to all of the above is NO, do not report it.

If no significant issues are found, return an empty JSON array.

Return only valid JSON.
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
    return `Return ONLY valid JSON.

Do not wrap the response in markdown.

Do not use triple backticks.

Return an array.

Each object must have exactly:

{
  "filename": string,
  "line": number,
  "explanation": string,
  "suggestedFix": string
}
Review ONLY the code shown in each Patch section.

Do not assume anything about code that is not present in the patch.

Do not report issues outside the modified lines.

Return one object for each independent issue.

Do not combine multiple problems into one object.

If you cannot confidently determine the changed line number from the patch,
do not report the issue.
`

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