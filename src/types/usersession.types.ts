import mongoose from "mongoose";

export interface IUserSession {
    userId : mongoose.Types.ObjectId,
    sessionId: string,
    refreshToken: string,
    createdAt: Date,
    expiresAt: Date
}