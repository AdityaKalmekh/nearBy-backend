import mongoose, { Document } from "mongoose";
import { IUser, IUserMethods, UserRole, UserStatus, UserModel } from "../types/user.types";

type UserDocument = Document<unknown, {}, IUser> & IUser & IUserMethods;

const userSchema = new mongoose.Schema<IUser, UserModel, IUserMethods>(
    {
        email: {
            type: String,
            sparse: true,
            lowercase: true,
            trim: true,
            validator: function (this: UserDocument, email: string): boolean {
                if (!email && this.phone) return true;
                if (!email) return false;
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            },
            message: 'Invalid email format or email is required when phone is not provided'
        },
        phone: {
            type: String,
            sparse: true,
            trim: true,
            validator: function (this: UserDocument, phone: string): boolean {
                if (!phone && this.email) return true;
                if (!phone) return false;
                return /^\d{10}$/.test(phone);
            },
            message: 'Phone number must be exactly 10 digits'
        },
        firstName: {
            type: String,
            trim: true,
            minLength: 2,
            maxLength: 50
        },
        lastName: {
            type: String,
            trim: true,
            minLength: 2,
            maxLength: 50
        },
        role: {
            type: Number,
            enum: Object.values(UserRole),
        },
        status: {
            type: String,
            enum: Object.values(UserStatus),
        },
        verifiedEmail: {
            type: Boolean,
            default: false
        },
        verifiedPhone: {
            type: Boolean,
            default: false
        },
        lastLogin: {
            type: Date
        },
        failedLoginAttempts: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

userSchema.methods.isProvider = function (this: UserDocument): boolean {
    return this.role === UserRole.Provider;
}

userSchema.methods.isRequester = function (this: UserDocument): boolean {
    return this.role === UserRole.Requester
}

userSchema.methods.getFullName = function (this: UserDocument): string | undefined {
    if (this.firstName && this.lastName) {
        return `${this.firstName} ${this.lastName}`;
    }
    return undefined
}

userSchema.static('findByEmail', function (email: string) {
    return this.findOne({ email: email.toLowerCase() });
});

userSchema.static('findByPhone', function (phone: string) {
    return this.findOne({ phone });
});

userSchema.static('createInitialUser', async function (identifier: { email?: string; phone?: string }) {
    return this.create({
        ...identifier,
        // status: UserStatus.INCOMPLETE,
        verifiedEmail: !!identifier.email,
        verifiedPhone: !!identifier.phone
    });
});

// Middleware
userSchema.pre('save', async function (this: UserDocument, next) {

    if (!this.email && !this.phone) {
        throw new Error('Either email or phone is required');
    }
    // Update status if profile is completed
    // if (this.isProfileComplete() && this.status === UserStatus.INCOMPLETE) {
    //     this.status = UserStatus.ACTIVE;
    // }
    next();
});

// Indexes
userSchema.index({ email: 1 }, { sparse: true });
userSchema.index({ phone: 1 }, { sparse: true });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: 1 });

export const User = mongoose.model<IUser, UserModel>('User', userSchema);