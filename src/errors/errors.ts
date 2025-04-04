export interface AppError extends Error {
    code: number;
}

export const createAppError = (
    message: string,
    code: number = 500,
    details?: unknown
): AppError & { details?: unknown } => {
    return ({    
    name: 'AppError',
    message,
    code,
    details
})};