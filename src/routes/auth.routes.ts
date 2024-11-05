import express from "express";
import { initiateAuth, verifyOTP } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";

const routes = express.Router();
    
routes.post("/auth/initiate", asyncHandler(initiateAuth));
routes.post("/auth/verify", asyncHandler(verifyOTP));

export default routes;