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
                if (!email && this.phoneNo) return true;
                if (!email) return false;
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            },
            message: 'Invalid email format or email is required when phone is not provided'
        },
        phoneNo: {
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
        roles: {
            type: [Number],
            enum: Object.values(UserRole).filter(value => typeof value === 'number'),
            validate : function(roles: UserRole[]): boolean {
                // Ensure array is not empty and all values are valid
                return roles.length > 0 && 
                    roles.every(role => Object.values(UserRole).includes(role));
            },
            message: 'User must have at least one valid role'
        },
        status: {
            type: String,
            enum: Object.values(UserStatus),
        },
        verifiedEmail: {
            type: Boolean,
            default: false
        },
        verifiedPhoneNo: {
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

userSchema.methods.hasRole = function(this: UserDocument, role: UserRole): boolean {
    return this.roles.includes(role);
};

userSchema.methods.isProvider = function (this: UserDocument): boolean {
    return this.hasRole(UserRole.provider);
}

userSchema.methods.isRequester = function (this: UserDocument): boolean {
    return this.hasRole(UserRole.requester);
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

userSchema.static('createInitialUser', async function (identifier: { email?: string; phoneNo?: string }) {
    return this.create({
        ...identifier,
        // status: UserStatus.INCOMPLETE,
        verifiedEmail: !!identifier.email,
        verifiedPhone: !!identifier.phoneNo
    });
});

// Middleware
userSchema.pre('save', async function (this: UserDocument, next) {

    if (!this.email && !this.phoneNo) {
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
userSchema.index({ phoneNo: 1 }, { sparse: true });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: 1 });

export const User = mongoose.model<IUser, UserModel>('User', userSchema);