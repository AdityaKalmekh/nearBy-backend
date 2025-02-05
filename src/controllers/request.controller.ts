import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import requestService from "../services/request.service";
import { createSuccess } from "../utils/response.utils";

let requestservice: ReturnType<typeof requestService>;

const initializeService = async () => {
    requestservice = requestService();
}

export const requestController = {

    findProviders: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        if (!requestservice) {
            await initializeService();
        }

        try {
            const { latitude, longitude } = req.body;

            // Input validation
            if (!latitude || !longitude) {
                return res.status(400).json({
                    error: 'Missing required location coordinates'
                });
            }

            // Find nearBy providers
            const providers = await requestservice.findNearbyProviders({ longitude, latitude });
            console.log(providers);

            res.status(200).json(providers);
        } catch (error) {
            next(error);
        }
    }),

    createRequest: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        if (!requestservice) {
            await initializeService();
        }

        try {
            const { latitude, longitude, userId } = req.body;
        
            if (!userId){
                return res.status(400).json({
                    error: 'userid is not define'
                })
            }
            
            if (!latitude || !longitude) {
                return res.status(400).json({
                    error: 'Missing required location coordinates'
                });
            }

            const createRequestResponse = await requestservice.createNewServiceRequest(req.body);    
            const providersAvailability = await requestservice.startProviderSearch(createRequestResponse);            
            res.json({ success: providersAvailability });

        } catch (error) {
            next(error);
        }
    }),

    providerResponse: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        const { requestId, providerId, accepted, userId } = req.body;

        try {
            const result = await requestservice.handleProviderResponse(
                requestId,
                providerId,
                accepted,
                userId
            );
            res.json(result);
        } catch (error) {
            next(error);
        }
    }),

    requestDetails: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        if (!requestservice) {
            await initializeService();
        }

        const { requestId } = req.params;
        try {
            const providerDetails = await requestservice.getServiceRequestDetails(requestId); 
            res.json(providerDetails);
        } catch (error) {
            next(error);
        }       
    }),

    requesterDetails: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        if (!requestService) {
            await initializeService();
        }
        
        const { requestId } = req.params;
        try {
            const requesterDetails = await requestservice.getRequesterDetails(requestId);
            res.json(requesterDetails);
        } catch (error) {
            next(error);
        }
    })
}