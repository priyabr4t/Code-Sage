import "dotenv/config";
import app from "./app.js";
import { logger } from "./shared/logger.js";
import { env } from "./config/env.js";

const PORT = env.PORT || 4000;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});