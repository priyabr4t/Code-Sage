import {Octokit} from "@octokit/rest";
import {env} from "../config/env"

export const github = new Octokit({
    auth: env.GITHUB_TOKEN
});