import { NextFunction, Request, Response } from 'express';
import createLocationTrackingService from '../services/locationTracking.service';
import { asyncHandler } from '../utils/asyncHandler';

let locationService: ReturnType<typeof createLocationTrackingService>;

const initializeService = async () => {
    locationService = createLocationTrackingService();
}

export const providerLocationController = {
    startTracking: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
       
        if (!locationService) {
            await initializeService();
        }
        const { providerId } = req.params;
        let { latitude, longitude, accuracy, source } = req.body;

        latitude = parseFloat(latitude);
        longitude = parseFloat(longitude);

        try {
            const response = await locationService.startShift(providerId, { longitude, latitude, accuracy, source });
            res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    }),

    stopTracking: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        if (!locationService) {
            await initializeService();
        }
        const { providerId } = req.params;
        try {
            const result = await locationService.endShift(providerId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    })
}