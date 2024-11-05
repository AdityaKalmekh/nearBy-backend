import mongoose from "mongoose";
import { IOTP } from "../types/otp.types";

const otpSchema = new mongoose.Schema<IOTP>(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        identifier: {
            type: String,
            required: true,
            trim: true,
        },
        otp: {
            type: String,
            required: true,
        },
        type: {
            type: String,
            enum: ['EMAIL', 'PHONE'],
            required: true,
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
        }
    }, {
    timestamps: true
});

export const OTP = mongoose.model<IOTP>("OTP",otpSchema);