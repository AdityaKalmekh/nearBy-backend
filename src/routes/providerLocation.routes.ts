import express from "express";
import { providerLocationController } from "../controllers/providerlocation.controller";

const routes = express.Router();

routes.post("/provider/location/start/:providerId", providerLocationController.startTracking);
routes.patch("/provider/location/update/:providerId", providerLocationController.updateLocation);
routes.post("/provider/location/stop/:providerId", providerLocationController.stopTracking);
export default routes;