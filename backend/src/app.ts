import express from "express";
import githubRoutes from "./modules/github/github.routes";
const app = express();

app.use("/webhooks/github", express.raw({ type: "application/json" }), githubRoutes);

app.use(express.json());

app.get("/health", (_, res) => {
    res.json({
        status: "ok"
    });
});

export default app;