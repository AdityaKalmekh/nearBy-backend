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

connectDB()
    .then(() => {
        console.log('✅ MongoDB connected successfully');
    })
    .catch((error) => {
        console.error('❌ MongoDB connection error:', error);
    });


// Base url
app.get('/', (req, res) => {
    res.json({
        status: 'Server is running',
        dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
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