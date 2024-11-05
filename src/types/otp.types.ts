import mongoose from "mongoose";

export type OTPType = 'EMAIL' | 'PHONE';
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
    createdAt: Date,
    updatedAt: Date
}