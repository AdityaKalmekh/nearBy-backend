import jwt from "jsonwebtoken";
import { IUser } from "../types/user.types";
import { Types } from "mongoose";

interface JWTPayload {
    userId: Types.ObjectId;
    email?: string;
    phone?: string;
    role: number;
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
 * Generates a JWT token for the user
 */
const generateToken = (user: IUser, role: number): string => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not defined in environment variables');
    }

    const payload: JWTPayload = {
        userId: user._id,
        email: user.email,
        phone: user.phoneNo,
        role: role 
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d' // Default 7 days
    });
};

/**
 * Verifies a JWT token and returns the decoded payload
 */
const verifyToken = (token: string): JWTPayload => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not defined in environment variables');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as JWTPayload;
        return decoded;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new Error('Token has expired');
        }
        if (error instanceof jwt.JsonWebTokenError) {
            throw new Error('Invalid token');
        }
        throw error;
    }
};

/**
 * Auth middleware to protect routes
 */
import { Request, Response, NextFunction } from 'express';
import { UserPayload } from "../types/custom";

const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        // const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>
        const token = req.cookies.JwtToken;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        // Verify token
        const decoded = verifyToken(token);

        // Add user info to request object
        req.user = decoded;

        next();
    } catch (error: any) {
        return res.status(401).json({
            success: false,
            message: error.message || 'Authentication failed'
        });
    }
};

// Role-based authorization middleware
const authorize = (allowedRoles: number[]): AsyncFunction => {
    return async(req: Request, res: Response, next: NextFunction): Promise<any> => {
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
    generateToken,
    verifyToken,
    authMiddleware,
    authorize
};