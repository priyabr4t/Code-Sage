import {randomUUID} from "crypto";
import {NextFunction, Request, Response} from "express";

declare global{
    namespace Express {
        interface Request {
            requestId: string;
        }
    }   
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
    req.requestId = randomUUID();
    next();
};