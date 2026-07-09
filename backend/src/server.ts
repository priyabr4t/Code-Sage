import dotenv from "dotenv";
import app from "./app.js";
import { logger } from "./shared/logger.js";

dotenv.config();

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});