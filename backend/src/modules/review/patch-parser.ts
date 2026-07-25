import { ChangedLines } from "./review.types";

export function parsePatch(patch: string): ChangedLines[] {
    const changedLines: ChangedLines[] = [];

    let newLine = 0;

    // Split patch into lines
    const lines = patch.split("\n");

    // Read every line
    for (const line of lines) {

        // Hunk header
        if (line.startsWith("@@")) {
            const match = line.match(/\+(\d+)(?:,\d+)?/);

            if (match) {
                newLine = Number(match[1]);
            }

            continue;
        }

        // Added line
        if (line.startsWith("+") && !line.startsWith("+++")) {
            changedLines.push({
                line: newLine,
                code: line.slice(1),
            });

            newLine++;
            continue;
        }

        // Deleted line
        if (line.startsWith("-") && !line.startsWith("---")) {
            continue;
        }

        // Context line
        if (line.startsWith(" ")) {
            newLine++;
        }
    }

    return changedLines;
}