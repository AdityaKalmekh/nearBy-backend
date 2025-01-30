import mongoose, { Schema } from "mongoose";
import { IRequestOTP } from "../types/requestOTP.types";


const RequestOTPSchema = new mongoose.Schema<IRequestOTP>(
    {
        serviceRequest: {
            type: Schema.Types.ObjectId,
            ref: 'ServiceRequest',
            required: true
        },
        provider: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        requester: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        otp: {
            type: String,
            required: true
        },
        expiresAt: {
            type: Date,
            required: true
        },
        verified: {
            type: Boolean,
            default: false
        },
        attempts: {
            type: Number,
            default: 0,
            max: 3 // Maximum verification attempts
        },
    }, {
        timestamps: true
});

RequestOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
RequestOTPSchema.index({ serviceRequest: 1, provider: 1 });

export const RequestOTP = mongoose.model<IRequestOTP>('RequestOTP', RequestOTPSchema);