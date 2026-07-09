import {Router} from "express";
import { webhookRequestHandler } from "./github.controller";

const router = Router();

router.post('/', webhookRequestHandler);

export default router;