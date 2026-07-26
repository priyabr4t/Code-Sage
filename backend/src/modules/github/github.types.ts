export interface PullRequestWebhookPayload {
    action: string;

    repository: {
        full_name: string;
    };

    pull_request: {
        number: number;

        head: {
            sha: string;
        };
    };
    sender?: {
        login: string
    },
    changes: string
}   