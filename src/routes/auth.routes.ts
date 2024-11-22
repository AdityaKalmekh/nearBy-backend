import express from "express";
import { initiateAuth, verifyOTP, details } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { jwtService } from "../utils/jwt.utils";
import { ROLES } from "../configs/roles";

const routes = express.Router();

routes.post("/auth/initiate", asyncHandler(initiateAuth));
routes.post("/auth/verify", asyncHandler(verifyOTP));
routes.patch("/details", asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER, ROLES.REQUESTER])),
    asyncHandler(details));

export default routes;