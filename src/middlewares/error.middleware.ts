import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: Error & { code?: string },
  req: Request,
  res: Response,
  next: NextFunction
) => {
  
  if (err.name === 'AppError') {
    res.status(500).json({
      success: false,
      error: {
        message: err.message,
        code: err.code,
        // details: process.env.NODE_ENV === 'development' ? err.details : undefined
      }
    });
  }
  // ... handle other errors
};