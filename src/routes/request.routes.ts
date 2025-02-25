import express from "express";
import { requestController } from "../controllers/request.controller";
import { requestOTPController } from "../controllers/requestOTP.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { jwtService } from "../utils/jwt.utils";
import { ROLES } from "../configs/roles";

const routes = express.Router();

routes.post("/providersAvailability",
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.REQUESTER])),
    requestController.findProviders);

routes.post("/request/provider",
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.REQUESTER])),
    requestController.createRequest);

routes.post("/request/response",
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER])),
    requestController.providerResponse);

routes.get("/request/provider-details/:requestId",
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.REQUESTER])), 
    requestController.requestDetails);

routes.get("/request/requester-details/:requestId",
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER])),
    requestController.requesterDetails);

routes.post("/request/:serviceRequestId/verify",
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize[ROLES.PROVIDER]),
    requestOTPController.verifyRequestOTP);

export default routes;