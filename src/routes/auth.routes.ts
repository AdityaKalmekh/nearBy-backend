import express from "express";
import { initiateAuth, verifyOTP, details, reSend, logout } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { jwtService } from "../utils/jwt.utils";
import { ROLES } from "../configs/roles";

const routes = express.Router();

routes.post("/auth/initiate", asyncHandler(initiateAuth));
routes.post("/auth/verify", asyncHandler(verifyOTP));
routes.patch("/resendOTP", asyncHandler(reSend));
routes.patch("/details", 
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER, ROLES.REQUESTER])),
    asyncHandler(details));
routes.delete("/logout",
    asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER, ROLES.REQUESTER])),
    asyncHandler(logout));

export default routes;