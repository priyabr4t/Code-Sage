export interface ReviewFile {
    filename: string
    patch: string
    changedLines : ChangedLines[]
}

export interface ChangedLines {
    line: number
    code: string
}