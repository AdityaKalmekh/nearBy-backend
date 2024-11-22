import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { jwtService } from '../utils/jwt.utils';
import { ROLES } from '../configs/roles';
import { createProvider } from '../controllers/provider.controller';

const routes = express.Router();

routes.post("/provider", asyncHandler(jwtService.authMiddleware),
    asyncHandler(jwtService.authorize([ROLES.PROVIDER])),
    asyncHandler(createProvider));

export default routes;