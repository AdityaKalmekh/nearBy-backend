import { Request, Response } from "express";
import { User } from "../models/User";
import { OTPService } from "../utils/otp.utils";
import { UserRole, UserStatus } from "../types/user.types";
import { jwtService } from "../utils/jwt.utils";
import { convertStringToUserRole } from "../utils/role.utils";

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
        }

        if (authType === 'PhoneNo' && !phoneNo) {
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
        }

        if (authType === 'PhoneNo' && !isValidPhone(identifier!)) {
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

        // If new user, create a temporary user record 
        if (isNewUser) {
            user = await User.create({
                [authType !== "Email" ? "phoneNo" : "email"]: identifier,
                roles: [userRole],
                status: UserStatus.PENDING,
                [`verified${authType}`]: false
            });
        } else {
            const hasRole = user?.roles.includes(userRole);
            if (!hasRole) {
                await User.findByIdAndUpdate(
                    user?.id,
                    { $addToSet: { roles: userRole } },
                    { new: true }
                )
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
            if (authType === 'EMAIL') {
                // await sendEmail(identifier!, otp);
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

        res.json({
            success: true,
            message: `OTP sent successfully to your ${authType.toLowerCase()}`,
            isNewUser,
            userId: user?._id,
            role: userRole,
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
        const { userId, otp, authType, role } = req.body;
        
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
        const isValid = await OTPService.verifyOTP(userId, otp);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired OTP'
            });
        }

        // Update user verification status
        user[`verified${authType}`] = true;
        // if (user.status === UserStatus.PENDING) {
        //     user.status = UserStatus.INCOMPLETE;  // User needs to complete profile
        // }
        await user.save();

        //Generate token
        const token = jwtService.generateToken(user, role);
        console.log(token);

        res.cookie('JwtToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: 'none',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/',
            domain: process.env.NODE_ENV === 'production' ? 'nearby-frontend-psi.vercel.app' : 'localhost'
        })

        res.json({
            success: 'success',
            code: 200,
            message: 'OTP verified successfully',
            user: {
                id: user._id,
                status: user.status,
                verifiedEmail: user.verifiedEmail,
                verifiedPhone: user.verifiedPhoneNo,
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

        const updateUser = await User.findByIdAndUpdate(
            userId,
            {
                firstName,
                lastName,
                status: UserStatus.ACTIVE
            },
            { new: true }
        )

        if (!updateUser) {
            return res.status(404).json({
                success: false,
                message: 'Failed to update profile'
            })
        }

        res.status(200).json({
            success: true,
            message: 'Profile details update successfully',
            user: updateUser
        })

    } catch (error: any) {
        console.error('Update details error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify OTP'
        });
    }
}