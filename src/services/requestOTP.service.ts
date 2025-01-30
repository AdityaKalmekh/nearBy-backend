import { createAppError } from "../errors/errors";
import { RequestOTP } from "../models/RequestOTP";
import { ServiceRequest } from "../models/ServiceRequest";
import { IRequestOTP } from "../types/requestOTP.types";

const requestOTPServices = () => {
    const generateOTP = (): string => {
        return Math.floor(1000 + Math.random() * 9000).toString();
    }

    const getExpiryTime = (): Date => {
        return new Date(Date.now() + 60 * 60 * 1000);
    }

    const generateRequestOTP = async (
        serviceRequestId: string,
        providerId: string,
        requesterId: string
    ): Promise<{ success: boolean }> => {

        const otp = generateOTP();
        const expiresAt = getExpiryTime();

        const requestOTP = new RequestOTP({
            serviceRequest: serviceRequestId,
            provider: providerId,
            requester: requesterId,
            otp,
            expiresAt
        });

        if (!requestOTP) {
            throw createAppError('Failed to generate OTP for request in db');
        }

        await requestOTP.save();
        
        return {
            success: true
        };
    }

    const verifyOTP = async (
        serviceRequestId: string,
        providerId: string,
        otpCode: string
    ): Promise<boolean> => {
        
        const requestOTP = await RequestOTP.findOne({
            serviceRequest: serviceRequestId,
            provider: providerId,
            verified: false
        });

        if (!requestOTP) {
            throw createAppError('Invalid OTP request');
        }

        if (requestOTP.attempts >= 3) {
            throw createAppError('Maximum verification attempts exceeded');
        }

        if (requestOTP.expiresAt < new Date()) {
            throw createAppError('OTP has expired');
        }

        requestOTP.attempts += 1;
        await requestOTP.save();

        if (requestOTP.otp !== otpCode) {
            await requestOTP.save();
            throw ('Invalid OTP');
        }

        await ServiceRequest.findByIdAndUpdate(serviceRequestId, {
            otpVerified: true,
            status: 'INPROCESS'
        });

        await RequestOTP.deleteOne({ _id: requestOTP._id});
        return true;
    };

    return {
        generateRequestOTP,
        verifyOTP
    };
}

export default requestOTPServices;