import { OTP } from "../models/Otp";
import { OTPPurpose, OTPType } from "../types/otp.types";
import { ObjectId } from "mongodb";
import { IUser } from "../types/user.types";
import { User } from "../models/User";
import { createAppError } from "../errors/errors";
import { getRedisClient } from "../configs/redis";

// Constants
const OTP_LENGTH: number = 4;
const OTP_EXPIRY_SECONDS: number = 10 * 60;
const MAX_ATTEMPTS: number = 3;
const MAX_RESEND_ATTEMPTS: number = 2;
const RESEND_COOLDOWN_SECONDS = 2 * 60;
const OTP_EXPIRY_MINUTES: number = 10;

// Key prefixes
const OTP_KEY_PREFIX = 'otp:';
const OTP_ATTEMPTS_PREFIX = 'otp:attempts:';
const OTP_RESEND_PREFIX = 'otp:resend:';

/**
 * Generates a random OTP of specified length
 */
const generateOTP = (): string => {
    return Math.floor(1000 + Math.random() * 9000).toString();
};

// const createOTP = async (
//     userId: ObjectId | undefined,
//     identifier: string,
//     type: OTPType,
//     purpose: OTPPurpose,
// ): Promise<string> => {
//     try {
//         const existingOTP = await OTP.findOne({ userId });

//         if (existingOTP) {

//             if (existingOTP.resendCount >= MAX_RESEND_ATTEMPTS) {
//                 const expiresAt = new Date();
//                 expiresAt.setHours(expiresAt.getHours() + 24);

//                 await OTP.findOneAndUpdate(
//                     { userId },
//                     { expiresAt } 
//                 );

//                 throw createAppError('Maximum resend attempts exceeded. Try again after sometime');
//             }
//         }

//         // Generate new OTP
//         const otp = generateOTP();
//         const expiresAt = new Date();
//         expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

//         if (existingOTP) {
//             await OTP.findOneAndUpdate(
//                 { userId },
//                 {
//                     otp,
//                     expiresAt,
//                     verified: false,
//                     attempts: 0,
//                     lastResendAt: new Date(),
//                     $inc: { resendCount: 1 }
//                 }
//             );
//         } else {
//             // Create new OTP document
//             await OTP.create({
//                 userId,
//                 identifier,
//                 otp,
//                 type,
//                 purpose,
//                 expiresAt,
//                 verified: false,
//                 attempts: 0,
//                 resendCount: 0,
//                 lastResendAt: new Date()
//             });
//         }

//         return otp;
//     } catch (error) {
//         throw error;
//     }
// };



/**
 * Verifies the OTP provided by the user
 */
// const verifyOTP = async (
//     userId: string,
//     otpInput: string,
//     authType: string
// ): Promise<boolean> => {

//     try {
//         const otpDoc = await OTP.findOne({
//             userId,
//             expiresAt: { $gt: new Date() }
//         });

//         if (!otpDoc) {
//             throw new Error('OTP not found or expired');
//         }

//         if (otpDoc.verified) {
//             throw new Error('OTP already used');
//         }

//         if (otpDoc.attemps >= MAX_ATTEMPTS) {
//             throw new Error('Maximum verification attempts exceeded');
//         }

//         // Increment attempts
//         otpDoc.attemps += 1;
//         await otpDoc.save();

//         // Check if OTP matches
//         if (otpDoc.otp !== otpInput) {
//             throw new Error('Invalid OTP');
//         }

//         const updateData: Partial<IUser> = {
//             isVerified: true,
//             [`verified${authType}`]: true
//         }

//         await User.findByIdAndUpdate(userId, updateData);

//         await OTP.deleteOne({ _id: otpDoc._id });
//         return true;
//     } catch (error) {
//         console.error('Error verifying OTP:', error);
//         throw error;
//     }
// };

const OTPService = () => {
    const redis = getRedisClient();

    if (!redis) {
        throw new Error('Redis client is not initialized');
    }

    const createOTP = async (
        userId: ObjectId | undefined,
        identifier: string,
        type: OTPType,
        purpose: OTPPurpose,
    ): Promise<string> => {
        try {
            const userIdStr = userId?.toString();

            if (!userIdStr) {
                throw createAppError('User ID is required');
            }

            const otpKey = `${OTP_KEY_PREFIX}${userIdStr}`;
            const attemptsKey = `${OTP_ATTEMPTS_PREFIX}${userIdStr}`;
            const resendKey = `${OTP_RESEND_PREFIX}${userIdStr}`;

            // Check resend count
            const resendCount = await redis.get(resendKey);
            const resendCountNum = resendCount ? parseInt(resendCount, 10) : 0;

            // Check if maximum resend attempts have been reached
            if (resendCountNum >= MAX_RESEND_ATTEMPTS) {
                // Check if the key already has a long expiry
                const ttl = await redis.ttl(resendKey);

                // If TTL is less than 12 hours, update it to 24 hours
                // This ensures we only update the expiry once when max attempts are reached
                if (ttl < 12 * 60 * 60) {
                    await redis.expire(resendKey, 24 * 60 * 60); // Set to 24 hours
                }

                throw createAppError('Maximum resend attempts exceeded. Try again after 24 hours', 429);
            }

            // Check cooldown if this is a resend (key exists)
            // if (await redis.exists(otpKey)) {
            //     // Get TTL of current cooldown
            //     const cooldownTTL = await redis.ttl(`${resendKey}:cooldown`);

            //     if (cooldownTTL > 0) {
            //         throw createAppError(`Please wait ${cooldownTTL} seconds before requesting a new OTP`);
            //     }
            // }

            // Generate new OTP
            const otp = generateOTP();

            // Store OTP data
            const otpData = {
                userId: userIdStr,
                identifier,
                type,
                purpose,
                otp,
                createdAt: Date.now()
            };

            // Use pipeline for better performance with multiple operations
            const pipeline = redis.pipeline();

            // Set OTP with expiry
            pipeline.set(otpKey, JSON.stringify(otpData), 'EX', OTP_EXPIRY_SECONDS);

            // Reset attempts counter
            pipeline.set(attemptsKey, '0', 'EX', OTP_EXPIRY_SECONDS);

            // Handle resend counter differently depending on whether it exists
            if (resendCountNum === 0) {
                // If this is the first time, set the counter to 1 with 10 min expiry
                pipeline.set(resendKey, '1', 'EX', OTP_EXPIRY_SECONDS);
            } else {
                // If counter already exists, increment it but keep its existing TTL
                pipeline.incr(resendKey);
            }

            // Set cooldown for next resend
            // pipeline.set(`${resendKey}:cooldown`, '1', 'EX', RESEND_COOLDOWN_SECONDS);

            await pipeline.exec();

            return otp;
        } catch (error) {
            throw error;
        }
    };

    const verifyOTP = async (
        userId: string,
        otpInput: string,
        authType: string
    ): Promise<boolean> => {
        try {
            const userIdStr = userId.toString();
            const otpKey = `${OTP_KEY_PREFIX}${userIdStr}`;
            const attemptsKey = `${OTP_ATTEMPTS_PREFIX}${userIdStr}`;
            const resendKey = `${OTP_RESEND_PREFIX}${userIdStr}`;

            // Get OTP data and attempts count
            const [otpDataStr, attemptsStr] = await redis.mget(otpKey, attemptsKey);

            if (!otpDataStr) {
                throw createAppError('OTP not found or expired');
            }

            const otpData = JSON.parse(otpDataStr);
            const attempts = parseInt(attemptsStr || '0', 10);

            if (attempts >= MAX_ATTEMPTS) {
                throw createAppError('Maximum verification attempts exceeded');
            }

            // Check if OTP matches
            if (otpData.otp !== otpInput) {
                // Increment attempts
                await redis.incr(attemptsKey);

                const remainingAttempts = MAX_ATTEMPTS - (attempts + 1);
                throw createAppError(`Invalid OTP. ${remainingAttempts} attempts remaining`);
            }

            // Update user verification status in MongoDB
            const updateData: Partial<IUser> = {
                isVerified: true,
                [`verified${authType}`]: true
            };

            await User.findByIdAndUpdate(userId, updateData);

            // Clean up ALL Redis keys related to this OTP flow
            await redis.del(otpKey, attemptsKey, resendKey);

            return true;
        } catch (error) {
            console.error('Error verifying OTP:', error);
            throw error;
        }
    };
    return {
        createOTP,
        verifyOTP
    }
}

export default OTPService;

// export const OTPService = {
//     createOTP,
//     verifyOTP
// }