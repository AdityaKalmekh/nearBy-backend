import { Document, Types } from 'mongoose';
import { User } from '../models/User';
import { Provider } from '../models/Provider';
import OTPService from '../utils/otp.utils';
import { jwtService } from '../utils/jwt.utils';
import { createAppError } from '../errors/errors';
import { encryptUserId, encryptProviderId, encryptUserData, generateSecureKey } from '../utils/dataEncrypt';
import { convertStringToUserRole } from '../utils/role.utils';
import { UserRole, UserStatus, IUser, IUserMethods } from '../types/user.types';
import { OTPType, OTPPurpose } from '../types/otp.types';
import { isValidEmail, isValidPhone } from '../utils/validators.utils';
import { UserSesssion } from '../models/UserSession';
import { sendEmail } from './email.service';

// Types for the service
export interface InitiateAuthParams {
    email?: string;
    phoneNo?: string;
    authType: 'Email' | 'PhoneNo';
    role: string;
}

export interface VerifyOTPParams {
    userId: string;
    otp: string;
    authType: string;
    role: number;
    isNewUser?: boolean;
}

export interface AuthResponse {
    success: boolean;
    code: number;
    message: string;
    user: any;
    secretKey?: string;
    encryptedData?: any;
    dev_otp?: string;
}

export interface VerifyResponse {
    success: boolean;
    code: number;
    message: string;
    authToken?: string;
    refreshToken?: string;
    session_id?: string;
    encryptedUId?: string;
    encryptionKey?: string;
    encryptedPId?: string;
    encryptionPKey?: string;
    user?: {
        role: number;
        status: string;
        firstName: string;
        lastName: string;
        fullName: string;
        authType: string;
    };
}

export interface ResendOTPParams {
    userId: string;
    authType: 'Email' | 'PhoneNo';
    isNewUser: boolean;
    contactOrEmail: string;
    firstName: string;
}

export interface ResendOTPResponse {
    success: boolean;
    message: string;
    dev_otp: string;
}

export interface UpdateUserDetailsParams {
    userId: string | Types.ObjectId;
    firstName: string;
    lastName: string;
    role: number;
}

export interface UpdateUserDetailsResponse {
    success: boolean;
    message: string;
    firstName: string;
    lastName: string;
    role: number;
    status: string;
}

export interface LogoutParams { 
    userId: string | Types.ObjectId;
}

export interface LogoutResponse { 
    success: boolean;
    message?: string;
}

type UserDocument = Document<unknown, {}, IUser> &
    Omit<IUser & Required<{ _id: Types.ObjectId }> & { __v: number }, keyof IUserMethods> &
    IUserMethods;

export const authService = {
    async initiateAuth(params: InitiateAuthParams): Promise<AuthResponse> {
        const { email, phoneNo, authType, role } = params;

        // Validate auth type
        if (!['Email', 'PhoneNo'].includes(authType)) {
            throw createAppError('Invalid authentication type', 400);
        }

        // Validate role
        let userRole: UserRole;
        try {
            userRole = convertStringToUserRole(role);
        } catch (error) {
            throw createAppError('Invalid user role', 400);
        }

        // Validate that we have either email or phone based on authType
        if (authType === 'Email' && !email) {
            throw createAppError('Email is required for email authentication', 400);
        } else if (authType === 'PhoneNo' && !phoneNo) {
            throw createAppError('Phone number is required for phone authentication', 400);
        }

        // Get the actual identifier value based on authType
        const identifier = authType === 'Email' ? email : phoneNo;

        // Validate format
        if (authType === 'Email' && !isValidEmail(identifier!)) {
            throw createAppError('Invalid email format', 400);
        } else if (authType === 'PhoneNo' && !isValidPhone(identifier!)) {
            throw createAppError('Invalid phone format. Must be 10 digits', 400);
        }

        // Find or create user - optimize with projection to retrieve only necessary fields
        const query = authType === 'Email' ? { email: identifier } : { phoneNo: identifier };
        let user = await User.findOne(query).select('_id firstName email phoneNo roles status');

        const isNewUser = !user;

        // Process user data
        if (isNewUser) {
            user = new User({
                [authType !== 'Email' ? 'phoneNo' : 'email']: identifier,
                roles: [userRole],
                status: UserStatus.PENDING,
                [`verified${authType}`]: false
            });
        } else if (user) {
            // For existing users, don't modify the email/phoneNo fields
            if (!user.roles.includes(userRole)) {
                // Use updateOne instead of save to avoid triggering the middleware
                await User.updateOne(
                    { _id: user._id },
                    { $addToSet: { roles: userRole } }
                );

                // Refresh user data after update
                user = await User.findById(user._id).select('_id firstName email phoneNo roles status') as UserDocument;

                if (!user) {
                    throw createAppError('User update failed', 500);
                }
            }
        } else {
            throw createAppError('User retrieval failed', 500);
        }

        // Save new user or generate OTP for existing user
        let savedUser: UserDocument;
        let otp: string;

        if (isNewUser) {
            // For new users, we need to save the document
            const [savedUserResult, otpResult] = await Promise.all([
                user.save(),
                OTPService().createOTP(
                    user._id,
                    identifier!,
                    authType.toUpperCase() as OTPType,
                    'SIGNUP' as OTPPurpose
                )
            ]);
            savedUser = savedUserResult;
            otp = otpResult;
        } else {
            // For existing users, we've already updated if needed
            otp = await OTPService().createOTP(
                user._id,
                identifier!,
                authType.toUpperCase() as OTPType,
                'LOGIN' as OTPPurpose
            );
            savedUser = user;
        }

        // Prepare user data for response
        const userData = {
            userId: user._id,
            firstName: user.firstName || '',
            authType,
            role: userRole,
            isNewUser,
            contactOrEmail: identifier || ''
        };

        // Send OTP notification (handled separately, not in this service)
        // Implement email/SMS sending logic in separate services
        if (authType === 'Email') {
            await sendEmail(identifier!, otp, isNewUser, savedUser.firstName);
            console.log('Email OTP', otp);
            // emailService.sendOTP(identifier, otp, isNewUser, savedUser.firstName)
            //    .catch(err => console.error('Failed to send email OTP:', err));
        } else {
            // Use your SMS service here
            console.log('Contact OTP', otp);
            // smsService.sendOTP(identifier, otp)
            //    .catch(err => console.error('Failed to send SMS OTP:', err));
        }

        // Encrypt user data for secure storage
        const secretKey = generateSecureKey();
        const encryptedData = encryptUserData(userData, secretKey);

        // Return response data
        return {
            success: true,
            code: 200,
            message: `OTP sent successfully to your ${authType.toLowerCase()}`,
            user: userData,
            secretKey,
            encryptedData,
            ...(process.env.NODE_ENV === 'development' && { dev_otp: otp })
        };
    },

    async verifyOTP(params: VerifyOTPParams): Promise<VerifyResponse> {
        const { userId, otp, authType, role, isNewUser } = params;
        let encryptedPId: string | undefined;
        let encryptionPKey: string | undefined;

        if (!userId || !otp || !authType) {
            throw createAppError('User ID, OTP, and auth type are required', 400);
        }

        // Find user and provider in parallel
        const [user, provider] = await Promise.all([
            User.findById(userId),
            role === 0 && !isNewUser ? Provider.findOne({ userId }, { _id: 1 }) : null
        ]);

        if (!user) {
            throw createAppError('User not found', 404);
        }

        // Verify OTP
        const isValid = await OTPService().verifyOTP(userId, otp, authType);
        if (!isValid) {
            throw createAppError('Error while verifying otp', 400);
        }

        // Determine user status
        let status: string | null = null;
        if (role === 0 && !isNewUser) {
            if (user.roles.includes(0) && !provider) {
                status = UserStatus.SERVICE_DETAILS_PENDING;
            }
        } else if (role === 1 && user.status === UserStatus.SERVICE_DETAILS_PENDING) {
            status = UserStatus.ACTIVE;
        }   

        console.log(`User current Status `, status);
        // Generate token
        const responseToken = await jwtService.generateTokens(user._id, user.status, role);
        const { encryptedUId, encryptionKey } = encryptUserId(user._id.toString());

        // Handle provider encryption if applicable
        if (role === 0 && provider) {
            const encryptionResult = encryptProviderId(provider._id.toString());
            encryptedPId = encryptionResult.encryptedPId;
            encryptionPKey = encryptionResult.encryptionPKey;
        }

        // Prepare user data safely
        const firstName = user.firstName || '';
        const lastName = user.lastName || '';

        // Return response data
        return {
            success: true,
            code: 200,
            message: 'OTP verified successfully',
            authToken: responseToken.authToken,
            refreshToken: responseToken.refreshToken,
            session_id: responseToken.sessionId,
            encryptedUId,
            encryptionKey,
            ...(role === 0 && provider && {
                encryptedPId,
                encryptionPKey
            }),
            user: {
                role,
                status: status || user.status,
                firstName,
                lastName,
                fullName: firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || '',
                authType
            }
        };
    },

    async resendOTP(params: ResendOTPParams): Promise<ResendOTPResponse> {
        const { userId, authType, isNewUser, contactOrEmail, firstName } = params;

        if (!userId || !authType || !contactOrEmail) {
            throw createAppError('Missing required parameters', 400);
        }

        // Determine the correct purpose
        const purpose = isNewUser ? 'SIGNUP' : 'LOGIN' as OTPPurpose;

        // Validate userId is a valid ObjectId
        if (!Types.ObjectId.isValid(userId)) {
            throw createAppError('Invalid user ID format', 400);
        }

        // Generate OTP
        const otp = await OTPService().createOTP(
            new Types.ObjectId(userId),
            contactOrEmail,
            authType.toUpperCase() as OTPType,
            purpose
        );

        return {
            success: true,
            message: `OTP resent successfully to your ${authType.toLowerCase()}`,
            dev_otp: otp
        };
    },

    async updateUserDetails(params: UpdateUserDetailsParams): Promise<UpdateUserDetailsResponse> {
        const { userId, firstName, lastName, role } = params;

        if (!userId) {
            throw createAppError('User ID is required', 400);
        }

        if (!firstName || !lastName) {
            throw createAppError('First name and last name are required', 400);
        }

        // Determine the new status based on user role
        const newStatus = role === 1 ? UserStatus.ACTIVE : UserStatus.SERVICE_DETAILS_PENDING;

        // Update user in the database
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                firstName,
                lastName,
                status: newStatus,
            },
            { new: true }
        );

        if (!updatedUser) {
            throw createAppError('User not found', 404);
        }

        // Return response with updated user data
        return {
            success: true,
            message: 'Profile details updated successfully',
            firstName: updatedUser.firstName || firstName,
            lastName: updatedUser.lastName || lastName,
            role,
            status: updatedUser.status
        };
    },

    async logout(params: LogoutParams): Promise<LogoutResponse> {
        const { userId } = params;

        if (!userId) {
            throw createAppError('User ID is required', 400);
        }

        const sessionDelection = await UserSesssion.findOneAndDelete({ userId });
        
        if (sessionDelection) {
            return {
                success: true,
                message: 'Logged out successfully'
            };
        } else {
            return {
                success: true,
                message: 'No active session found'
            };
        }
    }
};