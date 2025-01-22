import mongoose from "mongoose";
import { IUserSession } from "../types/usersession.types";

const userSessionSchema = new mongoose.Schema<IUserSession>(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        sessionId: {
            type: String,
            required: true
        },
        refreshToken: {
            type: String,
            required: true
        },
        createdAt: {
            type: Date,
            required: true
        },
        expiresAt: {
            type: Date,
            required: true
        }
    }
);

export const UserSesssion = mongoose.model<IUserSession>("User_Session", userSessionSchema);