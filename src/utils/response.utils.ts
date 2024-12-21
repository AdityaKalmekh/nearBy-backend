import { ServiceResult } from "../types/serviceresult.types";
import type { createAppError } from "../errors/errors";

export const createSuccess = <T>(data: T): ServiceResult<T> => ({
    success: true,
    data
})

export const createError = (error: ReturnType<typeof createAppError>): ServiceResult<never> => {
    console.log("Create Error is called");
    
    return ({
    success: false,
    error: {
        message: error.message,
        details: error.details
    }
})};