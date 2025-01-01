import express from "express";
import { requestController } from "../controllers/request.controller";

const routes = express.Router();

routes.post("/providers", requestController.findProviders);
routes.post("/request/provider", requestController.createRequest);
routes.post("/request/response", requestController.providerResponse);
routes.get("/request/provider-details/:providerId", requestController.providerDetails);
export default routes;