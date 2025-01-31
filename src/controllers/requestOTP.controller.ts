import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import requestOTPServices from "../services/requestOTP.service";

export const requestOTPController = {

    verifyRequestOTP: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { serviceRequestId } = req.params;
            const { otp, providerId } = req.body;
            
            const result = await requestOTPServices().verifyOTP(
                serviceRequestId,
                providerId,
                otp
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    })
}