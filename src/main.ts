import express, { Request, Response } from "express";
import cors from "cors"
import bodyParser from "body-parser";
import "dotenv/config";
import connectDB from "./configs/db";

// Import routes
import AuthRoute from "./routes/auth.routes"

// Error handler middleware
import { errorHandler } from "./middlewares/error.middleware";

const app = express();

// Middleware
app.use(cors({
    origin: "https://nearby-frontend-psi.vercel.app",
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// API Routers
app.use("/nearBy", AuthRoute);

// Base url
app.get('/', (req, res) => {
    res.json({ status: 'Server is running' });
});

app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// Error handler
app.use(errorHandler);

export default app;