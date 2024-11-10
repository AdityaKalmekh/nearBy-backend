import { Request, Response } from "express";
import { User } from "../models/User";
import { OTPService } from "../utils/otp.utils";
import { UserStatus } from "../types/user.types";
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
        const userRole = convertStringToUserRole(role);

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
        const { userId, otp, authType } = req.body;
        
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
        const token = jwtService.generateToken(user);

        res.cookie('JwtToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000
        })

        res.json({
            success: true,
            message: 'OTP verified successfully',
            token,
            user: {
                id: user._id,
                email: user.email,
                phone: user.phoneNo,
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