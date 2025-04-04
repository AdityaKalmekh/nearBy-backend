import { NextFunction, Request, Response } from "express";
import { sendEmail } from "../services/email.service";
import { authService, InitiateAuthParams, LogoutParams, ResendOTPParams, UpdateUserDetailsParams, VerifyOTPParams } from "../services/auth.service";

export const authController = {
    async initiateAuth(req: Request<{}, {}, InitiateAuthParams>, res: Response, next: NextFunction): Promise<void> {
        try {
            const result = await authService.initiateAuth(req.body);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async verifyOTP(req: Request<{}, {}, VerifyOTPParams>, res: Response, next: NextFunction): Promise<void> {
        try {
            const result = await authService.verifyOTP(req.body);

            const {
                cookieConfig,
                refreshCookieConfig,
                userIdCookieConfig
            } = req.app.locals.config || {
                cookieConfig: { 
                    httpOnly: true, 
                    secure: process.env.NODE_ENV === 'production', 
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                    maxAge: 60 * 60 * 1000 },
                refreshCookieConfig: { 
                    httpOnly: true, 
                    secure: process.env.NODE_ENV === 'production', 
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                    maxAge: 30 * 24 * 60 * 60 },
                userIdCookieConfig: { 
                    httpOnly: true, 
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', 
                    maxAge: 30 * 24 * 60 * 60 }
            };

            // Set cookies if verification was successful
            if (result.success && result.authToken && result.refreshToken && result.session_id) {
                // Set auth cookies
                res.cookie('auth_token', result.authToken, cookieConfig);
                res.cookie('refresh_token', result.refreshToken, refreshCookieConfig);
                res.cookie('session_id', result.session_id, {
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
                });

                // Set user identity cookies
                if (result.encryptedUId && result.encryptionKey) {
                    res.cookie("uid", result.encryptedUId, userIdCookieConfig);
                    res.cookie("diukey", result.encryptionKey, userIdCookieConfig);
                }

                // Set provider identity cookies if applicable
                if (result.encryptedPId && result.encryptionPKey) {
                    res.cookie('puid', result.encryptedPId, userIdCookieConfig);
                    res.cookie('puidkey', result.encryptionPKey, userIdCookieConfig);
                }
            }

            // Send response
            res.status(result.code).json(result);
        } catch (error) {
            next(error);
        }
    },

    async resendOTP(req: Request<{}, {}, ResendOTPParams>, res: Response, next: NextFunction): Promise<void> {
        try {
            const result = await authService.resendOTP(req.body);

            // Handle email or SMS sending asynchronously
            if (req.body.authType === 'Email') {
                // This would be handled by your email service
                sendEmail(req.body.contactOrEmail, result.dev_otp, req.body.isNewUser, req.body.firstName)
                    .catch(err => console.error('Failed to send email OTP:', err));

                if (process.env.NODE_ENV === 'development') {
                    console.log('Email OTP', result.dev_otp);
                }
            } else {

                if (process.env.NODE_ENV === 'development') {
                    console.log('Contact OTP', result.dev_otp);
                }
            }

            // Send successful response (without exposing OTP in production)
            res.status(200).json({
                success: true,
                message: result.message,
                ...(process.env.NODE_ENV === 'development' && { dev_otp: result.dev_otp })
            });
        } catch (error) {
            next(error);
        }
    },

    async updateUserDetails(req: Request<{}, {}, UpdateUserDetailsParams>, res: Response, next: NextFunction): Promise<void> {
        try {
            const { firstName, lastName } = req.body;
            const userId = req.user?.userId;
            const role = req.user?.role;

            // Validate required fields from request
            if (!userId || role === undefined) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            if (!firstName || !lastName) {
                res.status(400).json({
                    success: false,
                    message: 'First name and last name are required'
                });
                return;
            }

            // Call service to handle business logic
            const result = await authService.updateUserDetails({
                userId,
                firstName,
                lastName,
                role
            });

            // Update cookies if needed
            // Note: This is commented out as per your original code, but can be
            // uncommented and implemented if needed

            // Add error handling for JSON parsing
            // let existingUserData = {};
            // try {
            //   existingUserData = JSON.parse(req.cookies.User_Data || '{}');
            // } catch (error) {
            //   console.error('Error parsing User_Data cookie:', error);
            // }

            // const updatedUserData = JSON.stringify({
            //   ...existingUserData,
            //   firstName,
            //   lastName,
            //   status: result.status
            // });

            // res.cookie('User_Data', updatedUserData, cookieConfig);

            // Send response
            res.status(200).json(result);
        } catch (error: any) {
            console.log(error);
            next(error);
        }
    },

    async logout(req: Request<{}, {}, LogoutParams>, res: Response, next: NextFunction): Promise<void> {
        try {
            const { userId } = req.body;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }
            
            const result = await authService.logout({ userId });
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
}