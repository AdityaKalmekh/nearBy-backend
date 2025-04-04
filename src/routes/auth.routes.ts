import express from "express";
import { authController } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { jwtService } from "../utils/jwt.utils";
import { ROLES } from "../configs/roles";

const routes = express.Router();

routes.post("/auth/initiate", asyncHandler(authController.initiateAuth));
routes.post("/auth/verify", asyncHandler(authController.verifyOTP));
routes.patch("/resendOTP", asyncHandler(authController.resendOTP));
routes.patch("/details", 
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER, ROLES.REQUESTER])),
    asyncHandler(authController.updateUserDetails));
routes.delete("/logout",
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER, ROLES.REQUESTER])),
    asyncHandler(authController.logout));

export default routes;