import { Document, Types } from "mongoose";

export interface IRequestOTP extends Document {
    serviceRequest: Types.ObjectId;
    provider: Types.ObjectId;
    requester: Types.ObjectId;
    otp: string;
    expiresAt: Date;
    verified: boolean;
    attempts: number;
    createdAt: Date;
    updatedAt: Date;
}