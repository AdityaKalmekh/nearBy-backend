import express, { Request, Response } from "express";
import cors from "cors"
import bodyParser from "body-parser";
import "dotenv/config";
import connectDB from "./configs/db";
import mongoose from "mongoose";

// Import routes
import AuthRoute from "./routes/auth.routes"

// Error handler middleware
import { errorHandler } from "./middlewares/error.middleware";

const app = express();

// Middleware
app.use(cors({
    origin: "https://nearby-frontend-psi.vercel.app",
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

//Body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Connect to MongoDB
let dbConnection: any = null;
(async () => {
    try {
        dbConnection = await connectDB();
        console.log('Initial DB connection attempt completed');
    } catch (error) {
        console.error('Initial DB connection failed:', error);
    }
})();

// Health check endpoint
app.get('/', async (req: Request, res: Response) => {
    const dbStatus = mongoose.connection.readyState;
    const statusText = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting',
        99: 'uninitialized'
    }[dbStatus] || 'unknown';

    // Try reconnecting if disconnected
    if (dbStatus !== 1) {
        try {
            console.log('Attempting to reconnect to MongoDB...');
            dbConnection = await connectDB();
        } catch (error) {
            console.error('Reconnection failed:', error);
        }
    }

    res.json({
        status: 'Server is running',
        dbStatus: statusText,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// API Routers
app.use("/nearBy", AuthRoute);

// 404 handler
app.use('*', (req: Request, res: Response) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

export default app;