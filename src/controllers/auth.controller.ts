import { Request, Response } from "express";
import { User } from "../models/User";
import { OTPService } from "../utils/otp.utils";
import { UserRole, UserStatus } from "../types/user.types";
import { jwtService } from "../utils/jwt.utils";
import { convertStringToUserRole } from "../utils/role.utils";
import { Provider } from "../models/Provider";
import { IProvider } from "../types/provider.types";
import { sendEmail } from "../services/email.service";
import { log } from "console";
interface AuthRequestBody {
    email?: string,
    phone?: string,
    authType: 'EMAIL' | 'PHONE';
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

        // If it's not new and provider get providerId
        let provider: IProvider | null = null;
        if (userRole === 0 && !isNewUser) {
            const userId = user?._id;
            provider = await Provider.findOne(
                { userId: userId },
                { _id: 1 }  // Only return the _id field
            );

            if (!provider) {
                return res.status(404).json({
                    success: false,
                    message: 'Provider not found'
                });
            }
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

        res.cookie('t_auth_d', JSON.stringify({
            userId: user._id,
            firstName: user.firstName,
            authType,
            role,
            isNewUser,
            contactOrEmail: identifier
        }), {
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? 'none' : 'strict',
            maxAge: 5 * 60 * 1000, // Short expiry - 5 minutes
            path: '/'
        });

        res.json({
            success: true,
            code: 200,
            message: `OTP sent successfully to your ${authType.toLowerCase()}`,
            user: {
                userId: user._id,
                status: user.status,
                verifiedEmail: user.verifiedEmail,
                verifiedPhone: user.verifiedPhoneNo,
                authType,
                role: userRole,
                firstName: user.firstName,
                lastName: user.lastName,
                ...(userRole === 0 && { providerId: provider?._id }),
                isNewUser,
            },
            ...(process.env.NODE_ENV === 'development' && { dev_otp: otp })
        });
    } catch (error) {
        console.error("Initiate Auth Error:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate authentication'
        })
    }
}

export const verifyOTP = async (req: Request, res: Response) => {
    try {
        const { userId, otp, authType, role, providerId } = req.body;

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

        console.log(req.cookies.t_auth_d);
        res.clearCookie('t_auth_d');
        //Generate token
        const token = jwtService.generateToken(user, role);
        res.cookie('AuthToken', token, {
            httpOnly: false,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? 'none' : 'strict',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/',
            domain: process.env.NODE_ENV === 'production' ? '.onrender.com' : 'localhost'
        });

        const userData = JSON.stringify({
            userId: user._id,
            status: user.status,
            verifiedEmail: user.verifiedEmail,
            verifiedPhone: user.verifiedPhoneNo,
            authType,
            role,
            firstName: user.firstName,
            lastName: user.lastName,
            ...(role === 0 && { providerId }) 
        });

        res.cookie('User_Data', userData , {
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/',
            httpOnly: false,
            domain: process.env.NODE_ENV === 'production' ? '.onrender.com' : 'localhost'
        });

        res.json({
            success: true,
            code: 200,
            message: 'OTP verified successfully',
            status: user.status,
            role
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
        console.log("FirstName ",firstName);
        console.log("LastName ", lastName);
        console.log("UserId ", userId);
        console.log("Role ", role);
        
        const updateUser = await User.findByIdAndUpdate(
            userId,
            {
                firstName,
                lastName,
                status: role === 1 ? UserStatus.ACTIVE : UserStatus.SERVICE_DETAILS_PENDING,
            },
            { new: true }
        )

        console.log("Db result" , updateUser);
        if (!updateUser) {
            return res.status(404).json({
                success: false,
                message: 'Failed to update profile'
            })
        }

        console.log("User data cookies" , req.cookies.User_Data);
        console.log("Auth token ", req.cookies.AuthToken);

        res.cookie('User_Data', JSON.stringify({
            ...JSON.parse(req.cookies.User_Data),
            firstName,
            lastName,
            status: role === 1 ? UserStatus.ACTIVE : UserStatus.SERVICE_DETAILS_PENDING
        }),{
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? 'none' : 'strict',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/',
            httpOnly: false,
            domain: process.env.NODE_ENV === 'production' ? '.onrender.com' : 'localhost'
        });

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