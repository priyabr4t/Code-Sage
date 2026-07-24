import { github } from "../../lib/github";

export const getPullRequest = async (
    owner: string,
    repo: string,
    pullNumber: number
) => {
    const response = await github.pulls.get({
        owner,
        repo,
        pull_number: pullNumber
    })

    return response.data;
}

export const getPullRequestFiles = async (
    owner: string,
    repo: string,
    pullNumber: number
) => {
    const response = await github.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber
    })
    return response.data
}