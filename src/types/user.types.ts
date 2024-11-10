import { Types } from "mongoose";
import mongoose from "mongoose";

export enum UserRole {
    provider = 0,
    requester = 1,
    ADMIN = 2
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
    phoneNo?: string;
    roles: UserRole[];
    status: UserStatus;
    isVerified: boolean;
    verifiedEmail: boolean;
    verifiedPhoneNo: boolean;
    lastLogin?: Date;
    failedLoginAttempts: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface IUserMethods {
    hasRole(role: UserRole) : boolean;
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