import express from "express";
import githubRoutes from "./modules/github/github.routes";
const app = express();

app.use(express.json());

app.get("/health", (_, res) => {
    res.json({
        status: "ok"
    });
});
app.use("/webhooks", githubRoutes);
export default app;