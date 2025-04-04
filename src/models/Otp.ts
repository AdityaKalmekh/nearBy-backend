import mongoose from "mongoose";
import { IOTP } from "../types/otp.types";

const otpSchema = new mongoose.Schema<IOTP>(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        identifier: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        otp: {
            type: String,
            required: true,
        },
        type: {
            type: String,
            enum: ['EMAIL', 'PHONENO'],
            required: true,
            index: true
        },
        purpose: {
            type: String,
            enum: ['LOGIN', 'SIGNUP'],
            required: true
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 }
        },
        verified: {
            type: Boolean,
            default: false
        },
        attemps: {
            type: Number,
            default: 0
        },
        resendCount: {
            type: Number,
            default: 0
        },
        lastResendAt: {
            type: Date,
            required: true
        },
        blockedUntil: {
            type: Date,
            index: true
        }
    }, {
    timestamps: true
});

otpSchema.index({ userId: 1, verified: 1 });
otpSchema.index({ identifier: 1, type: 1, verified: 1 });
export const OTP = mongoose.model<IOTP>("OTP",otpSchema);