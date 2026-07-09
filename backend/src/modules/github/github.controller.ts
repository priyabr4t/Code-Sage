import { Request, Response } from 'express';
import { verifyGithubSignature } from './verifyGithubSignature';

export const webhookRequestHandler = async (req: Request, res: Response) => {
    console.log('Received webhook request:', req.body);


    // if (!verifyGithubSignature(req)) {
    // return res.status(401).json({
    //     message: "Invalid signature",
    // });

    console.log(req.body instanceof Buffer);
    console.log(req.body);

    res.status(200).json({ received: true });

}
