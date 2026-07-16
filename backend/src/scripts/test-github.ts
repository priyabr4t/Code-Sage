import "dotenv/config";

import { getPullRequest, getPullRequestFiles } from "../modules/github/github.service";

async function main() {
    const owner = "priyabr4t";
    const repo = "Code-Sage";
    const prNumber = 1;

    const pr = await getPullRequest(owner, repo, prNumber);
    
    console.log("===== Pull Request =====");
    console.log(pr.title)
    console.log(pr.state)
    console.log(pr.user.login)

    const files = await getPullRequestFiles(
        owner,
        repo,
        prNumber
    );

    console.log("\n===== Changed Files =====");

    for (const file of files) {
        console.log({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
        });
    }
}

main().catch(console.error)
