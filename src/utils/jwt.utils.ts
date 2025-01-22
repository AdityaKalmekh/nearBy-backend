import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import CryptoJS from "crypto-js";

interface JWTPayload {
    userId: Types.ObjectId;
    tokenType: string;
    iat: number;
    exp: number;
    role: number;
    status: string;
}
interface AuthenticatedRequest extends Request {
    user?: UserPayload
}

type AsyncFunction = (
    req: Request,
    res: Response,
    next: NextFunction
) => Promise<any>;


/**
 * Generates a Authentication token for the user
 */
const generateAuthToken = (userid: Types.ObjectId, status: string, role: number): string => {
    if (!process.env.JWT_AUTH_SECRET) {
        throw createAppError("Jwt Auth Secret Key is not define");
    }

    const payload: JWTPayload = {
        userId: userid,
        status,
        role,
        tokenType: 'access',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 1000)
    };

    return jwt.sign(payload, `${process.env.JWT_AUTH_SECRET}`);
};

/**
 * Generates a Refresh token for the user
 */
const generateRefreshToken = (userid: Types.ObjectId, status: string, role: number) => {
    // Refresh token payload
    const payload = {
        userId: userid,
        status: status,
        role,
        tokenType: 'refresh',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days expiry
    };

    // Generate JWT with different secret
    return jwt.sign(payload, process.env.JWT_REFRESH_SECRET + '_refresh');
};

const generateTokens = async (userid: Types.ObjectId, status: string, role: number) => {

    // Generate all tokens - Now passing userRole to refresh token
    const authToken = generateAuthToken(userid, status, role);
    const refreshToken = generateRefreshToken(userid, status, role);
    const sessionId = generateSessionId();

    const userSession = await UserSesssion.create({
        userId: userid,
        sessionId,
        refreshToken,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    if (!userSession) {
        throw createAppError("Failed to Store Session");
    }

    return {
        authToken,
        refreshToken,
        sessionId
    }
}

/**
 * Verifies a JWT token and returns the decoded payload
 */
const verifyAuthToken = async (authToken: string): Promise<JWTPayload> => {
    if (!process.env.JWT_AUTH_SECRET) {
        throw createAppError('JWT AUTH SECRET is not defined in environment variables');
    }

    try {
        const decoded = jwt.verify(authToken, process.env.JWT_AUTH_SECRET) as JWTPayload;
        console.log("Token docoded ", decoded);
        return decoded;
    } catch (error) {
        throw error;
    }
};

// Session ID Generation
const generateSessionId = () => {

    // Generate random bytes using CryptoJS
    const randomBytes = CryptoJS.lib.WordArray.random(32);

    // Convert to hex string
    let sessionId = randomBytes.toString(CryptoJS.enc.Hex);

    // Timestamp added
    const timeComponent = Date.now().toString(36);
    sessionId = `${timeComponent}-${sessionId}`;

    return sessionId;
};


const validateRefreshTokenInDB = async (refreshToken: string, userId: Types.ObjectId): Promise<boolean> => {
    const session = await UserSesssion.findOne({
        userId,
        refreshToken
    });

    return !!session;
};

// Token refresh mechanism
const refreshAuthToken = async (refreshToken: string) => {
    if (!process.env.JWT_REFRESH_SECRET) {
        throw createAppError('JWT_REFRESH_SECRET is not defined in environment variables');
    }

    try {
        const decoded = jwt.verify(
            refreshToken,
            process.env.JWT_REFRESH_SECRET + '_refresh'
        ) as JWTPayload;

        const isValidRefreshToken = await validateRefreshTokenInDB(refreshToken, decoded.userId);
        if (!isValidRefreshToken) {
            throw createAppError("Refresh token has been revoked");
        }

        const newAuthToken = generateAuthToken(
            decoded.userId,
            decoded.status,
            decoded.role
        );
        
        return { newAuthToken, decoded };
    } catch (error) {
        console.error('Refresh token error:', error);
        return { newAuthToken: null, decoded: null };
    }
}

// Generate New Auth Token From Refresh Token

const newAuthToken = async (refreshToken: string, res: Response) => {
    const { newAuthToken, decoded } = await refreshAuthToken(refreshToken);

    if (!newAuthToken || !decoded) {
        throw createAppError("Failed to generate new auth token");
    }

    // Set new auth token in cookie
    res.cookie('auth_token', newAuthToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        maxAge: 60 * 60 * 1000 // 1 hour
    });

    return decoded;
}


/**
 * Auth middleware to protect routes
 */
import { Request, Response, NextFunction } from 'express';
import { UserPayload } from "../types/custom";
import { UserSesssion } from "../models/UserSession";
import { createAppError } from "../errors/errors";

const getSessionFromDB = async (sessionId: string) => {
    const isValid = await UserSesssion.find({ sessionId: sessionId });
    if (!isValid) {
        throw createAppError("Refresh Token Not found in DB");
    }
    return true;
}

const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        // const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>
        const authToken = req.cookies.auth_token;
        const refreshToken = req.cookies.refresh_token;
        const sessionId = req.cookies.session_id;

        if (!refreshToken || !sessionId) {
            throw createAppError("Missing required tokens");
        }

        const session = await getSessionFromDB(sessionId);
        if (!session) {
            throw createAppError("Invalid session");
        }

        // If no auth token exists, directly generate new one
        if (!authToken) {
            const decoded = await newAuthToken(refreshToken, res);
            req.user = decoded;
            return next();
        }

        try {
            const decoded = await verifyAuthToken(authToken);
            req.user = decoded;
            return next();
        } catch (tokenError) {
            if (tokenError instanceof jwt.TokenExpiredError) {
                const decoded = await newAuthToken(refreshToken, res);
                req.user = decoded;
                return next();
            }
            throw tokenError;
        }
    } catch (error: any) {
        // Clear cookies on authentication failure
        res.clearCookie('auth_token');
        res.clearCookie('refresh_token');
        res.clearCookie('session_id');
        return res.status(401).json({
            success: false,
            message: error.message || 'Authentication failed'
        });
    }
};

// Role-based authorization middleware
const authorize = (allowedRoles: number[]): AsyncFunction => {
    return async (req: Request, res: Response, next: NextFunction): Promise<any> => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to access this resource'
            });
        }
        next();
    };
};

export const jwtService = {
    generateTokens,
    authMiddleware,
    authorize,
};