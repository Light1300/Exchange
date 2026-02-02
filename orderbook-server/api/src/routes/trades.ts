import { Router } from "express";

export const tradesRouter = Router();

tradesRouter.get("/", async(req:Request, res:Response)=>{
    const { market } = req.body;
    
    res.json({});
})