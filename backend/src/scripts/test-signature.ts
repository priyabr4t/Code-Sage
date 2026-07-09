import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import { env } from "../config/env";

const payload = Buffer.from(
    JSON.stringify(JSON.parse(fs.readFileSync("payload.json", "utf8")))
);

const signature =
    "sha256=" +
    crypto
        .createHmac("sha256", env.GITHUB_WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");

console.log(signature);