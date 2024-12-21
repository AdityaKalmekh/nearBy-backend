// export const createAppError = (
//     message: string,
//     code: ErrorCode,
//     details?: unknown
// ): Error & { code: ErrorCode; details?: unknown } => ({
//     name: 'AppError',
//     message,
//     code,
//     details
// });
export interface ServiceResult<T> {
    success: boolean;
    data?: T;
    error?: {
      message: string;
      details?: unknown;
    };
  }
