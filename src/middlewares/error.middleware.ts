import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: Error & { code: number },
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err.name === 'AppError') {
    res.status(err.code).json({
      success: false,
      message: err.message,
      code: err.code,
    });
  }
};