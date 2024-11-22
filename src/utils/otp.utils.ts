import { OTP } from "../models/Otp";
import { OTPPurpose, OTPType } from "../types/otp.types";
import { ObjectId } from "mongodb";
import { IUser } from "../types/user.types";
import { User } from "../models/User";

// Constants
const OTP_LENGTH: number = 4;
const OTP_EXPIRY_MINUTES: number = 10;
const MAX_ATTEMPS: number = 3;

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
    // userId: mongoose.Types.ObjectId | undefined
): Promise<string> => {
    try {
        // Delete any existing OTP for this identifier
        await OTP.deleteMany({ userId });

        // Generate new OTP
        const otp = generateOTP();

        // Calculate expiry time
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

        // Create new OTP document
        await OTP.create({
            userId,
            identifier,
            otp,
            type,
            purpose,
            expiresAt,
            verified: false,
            attempts: 0
        });

        return otp;
    } catch (error) {
        console.error('Error creating OTP:', error);
        throw new Error('Failed to create OTP');
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
            isVerified : true,
           [`verified${authType}`] : true 
        } 

        await User.findByIdAndUpdate(userId, updateData);

        await OTP.deleteOne({ _id: otpDoc._id});
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