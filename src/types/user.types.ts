import { Types } from "mongoose";
import mongoose from "mongoose";

export enum UserRole {
    Provider = 0,
    ADMIN = 1,
    Requester = 2
}

export enum UserStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    SUSPENDED = 'suspended',
    PENDING = 'pending'
}

export interface IUser {
    _id: Types.ObjectId;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    role: UserRole;
    status: UserStatus;
    isVerified: boolean;
    verifiedEmail: boolean;
    verifiedPhone: boolean;
    lastLogin?: Date;
    failedLoginAttempts: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface IUserMethods {
    isProvider(): boolean;
    isRequester(): boolean;
    getFullName(): string | undefined
}

export interface UserModel extends mongoose.Model<IUser, {}, IUserMethods> {
    findByEmail(email: string): Promise<(mongoose.Document<unknown, {}, IUser> & IUser & IUserMethods) | null>;
    findByPhone(phone: string): Promise<(mongoose.Document<unknown, {}, IUser> & IUser & IUserMethods) | null>;
    createInitialUser(identifier: { email?: string; phone?: string }): Promise<mongoose.Document<unknown, {}, IUser> & IUser & IUserMethods>;
}

// export interface IUserDocument extends Omit<IUser, '_id'>, Document, IUserMethods {
//     _id: Types.ObjectId;
// }