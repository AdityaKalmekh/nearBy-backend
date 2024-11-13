import express from "express";
import { initiateAuth, verifyOTP, details } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { jwtService } from "../utils/jwt.utils";

const routes = express.Router();

routes.post("/auth/initiate", asyncHandler(initiateAuth));
routes.post("/auth/verify", asyncHandler(verifyOTP));
routes.patch("/details",asyncHandler(jwtService.authMiddleware), asyncHandler(details));

export default routes;