import mongoose from "mongoose";

export type OTPType = 'EMAIL' | 'PHONENO';
export type OTPPurpose = 'LOGIN'| 'SIGNUP';

export interface IOTP {
    userId: mongoose.Types.ObjectId | undefined,
    identifier: string,
    otp: string,
    type: OTPType,
    purpose: OTPPurpose,
    expiresAt: Date,
    verified: boolean,
    attemps: number,
    resendCount: number,
    lastResendAt: Date,
    blockedUntil: Date,
    createdAt: Date,
    updatedAt: Date
}