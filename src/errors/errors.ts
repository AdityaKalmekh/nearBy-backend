export const createAppError = (
    message: string,
    details?: unknown
): Error & { details?: unknown } => {
    return ({    
    name: 'AppError',
    message,
    details
})};

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