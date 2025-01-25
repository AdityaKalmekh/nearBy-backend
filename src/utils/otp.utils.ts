import { OTP } from "../models/Otp";
import { OTPPurpose, OTPType } from "../types/otp.types";
import { ObjectId } from "mongodb";
import { IUser } from "../types/user.types";
import { User } from "../models/User";
import { createAppError } from "../errors/errors";

// Constants
const OTP_LENGTH: number = 4;
const OTP_EXPIRY_MINUTES: number = 10;
const MAX_ATTEMPS: number = 3;
const MAX_RESEND_ATTEMPTS: number = 2;
const RESEND_COOLDOWN_MINUTES = 2;

/**
 * Generates a random OTP of specified length
 */
const generateOTP = (): string => {
    return Math.floor(1000 + Math.random() * 9000).toString();
};

const createOTP = async (
    userId: ObjectId | undefined,
    identifier: string,
    type: OTPType,
    purpose: OTPPurpose,
): Promise<string> => {
    try {
        const existingOTP = await OTP.findOne({ userId });

        if (existingOTP) {

            if (existingOTP.resendCount >= MAX_RESEND_ATTEMPTS) {
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 1);

                await OTP.findOneAndUpdate(
                    { userId },
                    { expiresAt } 
                );

                throw createAppError('Maximum resend attempts exceeded. Try again after sometime');
            }
        }

        // Generate new OTP
        const otp = generateOTP();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

        if (existingOTP) {
            await OTP.findOneAndUpdate(
                { userId },
                {
                    otp,
                    expiresAt,
                    verified: false,
                    attempts: 0,
                    lastResendAt: new Date(),
                    $inc: { resendCount: 1 }
                }
            );
        } else {
            // Create new OTP document
            await OTP.create({
                userId,
                identifier,
                otp,
                type,
                purpose,
                expiresAt,
                verified: false,
                attempts: 0,
                resendCount: 0,
                lastResendAt: new Date()
            });
        }

        return otp;
    } catch (error) {
        throw error;
    }
};

/**
 * Verifies the OTP provided by the user
 */
const verifyOTP = async (
    userId: string,
    otpInput: string,
    authType: string
): Promise<boolean> => {

    try {
        const otpDoc = await OTP.findOne({
            userId,
            expiresAt: { $gt: new Date() }
        });

        if (!otpDoc) {
            throw new Error('OTP not found or expired');
        }

        if (otpDoc.verified) {
            throw new Error('OTP already used');
        }

        if (otpDoc.attemps >= MAX_ATTEMPS) {
            throw new Error('Maximum verification attempts exceeded');
        }

        // Increment attempts
        otpDoc.attemps += 1;
        await otpDoc.save();

        // Check if OTP matches
        if (otpDoc.otp !== otpInput) {
            throw new Error('Invalid OTP');
        }

        const updateData: Partial<IUser> = {
            isVerified: true,
            [`verified${authType}`]: true
        }

        await User.findByIdAndUpdate(userId, updateData);

        await OTP.deleteOne({ _id: otpDoc._id });
        return true;
    } catch (error) {
        console.error('Error verifying OTP:', error);
        throw error;
    }
};

export const OTPService = {
    createOTP,
    verifyOTP
}