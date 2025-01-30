import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import requestOTPServices from "../services/requestOTP.service";
import { ServiceRequest } from "../models/ServiceRequest";
import { createAppError } from "../errors/errors";
import { OTPService } from "../utils/otp.utils";

export const requestOTPController = {
    generateRequestOTP: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { serviceRequestId } = req.params;
            const serviceRequest = await ServiceRequest.findById(serviceRequestId);

            if (!serviceRequest || !serviceRequest.provider) {
                throw createAppError('Service request or provider not found');
            }

            const response = await requestOTPServices().generateRequestOTP(
                serviceRequestId,
                serviceRequest?.provider?.toString(),
                serviceRequest?.requester.toString()
            );

            return res.status(200).json(response);
        } catch (error) {
            next(error)
        }
    }),

    verifyRequestOTP: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { serviceRequestId } = req.params;
            const { otp, providerId } = req.body;

            console.log({ serviceRequestId });
            console.log({ otp });
            console.log({ providerId });
            
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