import "dotenv/config";

import { getPullRequest, getPullRequestFiles } from "../modules/github/github.service";
import { prepareReviewFiles } from "../modules/review/review.service";

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

    const reviewFiles = prepareReviewFiles(files);

    console.log("\n===== Review Files =====");

    console.log(reviewFiles);
}

main().catch(console.error)
