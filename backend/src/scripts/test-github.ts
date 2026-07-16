import "dotenv/config";

import { getPullRequest } from "../modules/github/github.service";

async function main() {
    const pr = await getPullRequest(
        "priyabr4t",
        "Code-Sage",
        5 // replace with a real PR number
    );

    console.log(pr.title)
    console.log(pr.state)
    console.log(pr.user.login)
}

main().catch(console.error)
