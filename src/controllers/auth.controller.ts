import { CookieOptions, Request, Response } from "express";
import { User } from "../models/User";
import { OTPService } from "../utils/otp.utils";
import { UserRole, UserStatus } from "../types/user.types";
import { jwtService } from "../utils/jwt.utils";
import { convertStringToUserRole } from "../utils/role.utils";
import { Provider } from "../models/Provider";
import { IProvider } from "../types/provider.types";
import { sendEmail } from "../services/email.service";
import { encryptProviderId, encryptUserData, encryptUserId, generateSecureKey } from "../utils/dataEncrypt";
import { UserSesssion } from "../models/UserSession";
interface AuthRequestBody {
    email?: string,
    phone?: string,
    authType: 'EMAIL' | 'PHONE';
}

interface Tokens {
    authToken: string;
    refreshToken: string;
    sessionId: string;
}

// Helper function to validate email
const isValidEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// Helper function to validate phone
const isValidPhone = (phoneNo: string): boolean => {
    return /^\d{10}$/.test(phoneNo);
};

const validateAuthInput = (identifier: string, type: 'EMAIL' | 'PHONE') => {
    if (!identifier || !type) {
        return { isValid: false, message: 'Identifier and type are required' };
    }

    if (type === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
        return { isValid: false, message: 'Invalid email format' };
    }

    if (type === 'PHONE' && !/^\d{10}$/.test(identifier)) {
        return { isValid: false, message: 'Invalid phone format. Must be 10 digits' };
    }

    return { isValid: true };
};

const cookieConfig: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 60 * 60 * 1000,
    path: '/',
};

const initialDataConfig: CookieOptions = {
    ...cookieConfig,
    maxAge: 10 * 60 * 1000
}

const refreshCookieConfig: CookieOptions = {
    ...cookieConfig,
    maxAge: 30 * 24 * 60 * 60
};

const userIdCookieConfig: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60
}

export const initiateAuth = async (req: Request, res: Response) => {
    try {
        const { email, phoneNo, authType, role } = req.body;

        // Validate auth type
        if (!['Email', 'PhoneNo'].includes(authType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid authentication type'
            });
        }

        // Validate role
        let userRole: UserRole;

        try {
            userRole = convertStringToUserRole(role);
        } catch (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user role'
            });
        }

        // Validate that we have either email or phone based on authType
        if (authType === 'Email' && !email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required for email authentication'
            });
        } else if (authType === 'PhoneNo' && !phoneNo) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required for phone authentication'
            });
        }

        // Get the actual identifier value based on authType
        const identifier = authType === 'Email' ? email : phoneNo;

        // Validate format
        if (authType === 'Email' && !isValidEmail(identifier!)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        } else if (authType === 'PhoneNo' && !isValidPhone(identifier!)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone format. Must be 10 digits'
            });
        }

        // Check if user exists
        let user = await User.findOne(
            authType === 'Email' ? { email: identifier } : { phoneNo: identifier }
        );

        const isNewUser = !user;

        // If new user, create a record 
        if (isNewUser) {
            user = await User.create({
                [authType !== "Email" ? "phoneNo" : "email"]: identifier,
                roles: [userRole],
                status: UserStatus.PENDING,
                [`verified${authType}`]: false
            });

            if (!user) {
                return res.json({
                    success: false,
                    message: 'User not created'
                })
            }
        } else {
            const hasRole = user?.roles.includes(userRole);
            if (!hasRole) {
                user = await User.findByIdAndUpdate(
                    user?.id,
                    { $addToSet: { roles: userRole } },
                    { new: true }
                )

                if (!user) {
                    return res.json({
                        success: false,
                        message: 'User role not updated'
                    })
                }
            }
        }

        if (!user) {
            return res.json({
                success: false,
                message: 'User Data not found'
            })
        }

        // Generate OTP
        const otp = await OTPService.createOTP(
            user?._id,
            identifier!,
            authType.toUpperCase(),
            isNewUser ? 'SIGNUP' : 'LOGIN'
        );

        // Send OTP based on authType
        try {
            if (authType === 'Email') {
                await sendEmail(identifier!, otp, isNewUser, user.firstName);
                console.log('Email OTP', otp);
            } else {
                // await sendSMS(identifier!, otp);
                console.log('Contact OTP', otp);
            }
        } catch (error) {
            console.error('Failed to send OTP:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to send OTP. Please try again.'
            });
        }

        const data = {
            userId: user._id,
            firstName: user.firstName,
            authType,
            role: userRole,
            isNewUser,
            contactOrEmail: identifier
        }
        const secretKey = generateSecureKey();
        const encryptedData = encryptUserData(data, secretKey);

        // res.cookie('t_data_key', JSON.stringify(secretKey), initialDataConfig);
        // res.cookie('initiate_d', JSON.stringify(encryptedData), initialDataConfig);

        res.json({
            success: true,
            code: 200,
            message: `OTP sent successfully to your ${authType.toLowerCase()}`,
            user: {
                userId: user._id,
                authType,
                role: userRole,
                firstName: user.firstName,
                isNewUser,
                contactOrEmail: identifier,
                status: user.status
            },
            secretKey,
            encryptedData,
            ...(process.env.NODE_ENV === 'development' && { dev_otp: otp })
        });
    } catch (error) {
        // console.error("Initiate Auth Error:", error);
        // res.status(500).json({
        //     success: false,
        //     message: 'Failed to initiate authentication'
        // })
        console.log(error);
        throw error;
    }
}

export const verifyOTP = async (req: Request, res: Response) => {
    try {
        const { userId, otp, authType, role, isNewUser } = req.body;
        let encryptedPId: string | undefined;
        let encryptionPKey: string | undefined;

        if (!userId || !otp || !authType) {
            return res.status(400).json({
                success: false,
                message: 'User ID, OTP, and auth type are required'
            });
        }

        // Find user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify OTP
        const isValid = await OTPService.verifyOTP(userId, otp, authType);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Error while verifying otp'
            });
        }

        // If it's not new and provider get providerId
        let provider: IProvider | null = null;
        let status: string | null = null;
        if (role === 0 && !isNewUser) {
            if (user.roles.includes(0)) {
                const userId = user?._id;
                provider = await Provider.findOne(
                    { userId: userId },
                    { _id: 1 }  // Only return the _id field
                );

                if (!provider) {
                    status = user.status;
                }
            } else {
                status = user.status;
            }
        } else if (role === 1 && user.status === UserStatus.SERVICE_DETAILS_PENDING) {
            status = UserStatus.ACTIVE;
        }

        // res.clearCookie('t_data_key_c');
        // res.clearCookie('initiate_d_c');
        //Generate token
        const responseToken: Tokens = await jwtService.generateTokens(user._id, user.status, role);
        const { encryptedUId, encryptionKey } = encryptUserId(user._id.toString());
        if (role === 0 && provider) {
            const encryptionResult = encryptProviderId(provider._id.toString());
            encryptedPId = encryptionResult.encryptedPId;
            encryptionPKey = encryptionResult.encryptionPKey;

            res.cookie('puid', encryptedPId, userIdCookieConfig);
            res.cookie('puidkey', encryptionPKey, userIdCookieConfig);
        }

        res.cookie('auth_token', responseToken.authToken, cookieConfig);
        res.cookie('refresh_token', responseToken.refreshToken, refreshCookieConfig);
        res.cookie('session_id', responseToken.sessionId, {
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
        });
        res.cookie("uid", encryptedUId, userIdCookieConfig);
        res.cookie("diukey", encryptionKey, userIdCookieConfig);
   
        res.json({
            success: true,
            code: 200,
            message: 'OTP verified successfully',
            authToken: responseToken.authToken,
            refreshToken: responseToken.refreshToken,
            session_id: responseToken.sessionId,
            encryptedUId,
            encryptionKey,
            ...(role === 0 && {
                encryptedPId,
                encryptionPKey
            }),
            user: {
                role,
                status: status ? status : user.status,
                firstName: user.firstName,
                lastName: user.lastName,
                fullName: `${user.firstName} ${user.lastName}`,
                authType
            }
        });

    } catch (error: any) {
        console.error('Verify OTP error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify OTP'
        });
    }
}

export const details = async (req: Request, res: Response) => {
    try {
        const { firstName, lastName } = req.body;
        const userId = req.user?.userId;
        const role = req.user?.role;

        const updateUser = await User.findByIdAndUpdate(
            userId,
            {
                firstName,
                lastName,
                status: role === 1 ? UserStatus.ACTIVE : UserStatus.SERVICE_DETAILS_PENDING,
            },
            { new: true }
        );

        if (!updateUser) {
            return res.status(404).json({
                success: false,
                message: 'Failed to update profile'
            })
        }
        // Add error handling for JSON parsing
        // let existingUserData: {};
        // try {
        //     existingUserData = JSON.parse(req.cookies.User_Data || '{}');
        // } catch (error) {
        //     console.error('Error parsing User_Data cookie:', error);
        //     existingUserData = {};
        // }

        // const updatedUserData = JSON.stringify({
        //     ...existingUserData,
        //     firstName,
        //     lastName,
        //     status: role === 1 ? UserStatus.ACTIVE : UserStatus.SERVICE_DETAILS_PENDING
        // });

        // res.cookie('User_Data', updatedUserData, cookieConfig);

        res.status(200).json({
            success: true,
            message: 'Profile details update successfully',
            firstName,
            lastName,
            role
        })

    } catch (error: any) {
        console.error('Update details error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify OTP'
        });
    }
}

export const reSend = async (req: Request, res: Response) => {
    try {
        const { userId, authType, isNewUser, contactOrEmail, firstName } = req.body;
        const purpose = isNewUser ? 'LOGIN' : 'SIGNUP';
        const OTP = await OTPService.createOTP(
            userId,
            contactOrEmail,
            authType.toUpperCase(),
            purpose
        );

        if (authType === 'Email') {
            await sendEmail(contactOrEmail!, OTP, isNewUser, firstName);
            console.log('Email OTP', OTP);
        } else {
            console.log('Contact OTP', OTP);
        }

        return res.status(200).json({
            success: true,
            otp: OTP
        });

    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate resend OTP'
        });
    }
}

export const logout = async (req: Request, res: Response) => {
    try {
        const { userId } = req.body;
        const sessionDelection = await UserSesssion.findOneAndDelete({ userId });

        if (sessionDelection) {
            res.status(200).json({ success: true });
        }

    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed To logout'
        })
    }
}