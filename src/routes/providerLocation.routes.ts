import express from "express";
import { providerLocationController } from "../controllers/providerlocation.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { jwtService } from "../utils/jwt.utils";
import { ROLES } from "../configs/roles";

const routes = express.Router();

routes.post("/provider/location/start/:providerId",
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER])),
    providerLocationController.startTracking);

routes.post("/provider/location/stop/:providerId", 
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER])),
    providerLocationController.stopTracking);
    
export default routes;