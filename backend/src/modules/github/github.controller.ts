import { Request, Response } from 'express';

export const webhookRequestHandler = async (req: Request, res: Response) => {
    console.log('Received webhook request:', req.body);

    res.status(200).json({ received: true });
}