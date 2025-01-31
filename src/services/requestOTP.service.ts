import { createAppError } from "../errors/errors";
import { RequestOTP } from "../models/RequestOTP";
import { ServiceRequest } from "../models/ServiceRequest";

const requestOTPServices = () => {

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
        verifyOTP
    };
}

export default requestOTPServices;