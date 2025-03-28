import { Types } from "mongoose";

export interface UserPayload {
    userId: Types.ObjectId;
    email?: string;
    phone?: string;
    role: number;
    iat?: number;
    exp?: number;
}

declare global {
    namespace Express {
        interface Request {
            user?: UserPayload
        }
    }
}

export {}