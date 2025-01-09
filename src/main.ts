
loadEnv();

import express, { Request, Response } from "express";
import cors from "cors"
import bodyParser from "body-parser";
import connectDB from "./configs/db";
import connectRedis, { disconnectRedis } from "./configs/redis";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { createSocketServer } from "./configs/socketServer";

// Import routes
import AuthRoute from "./routes/auth.routes";
import ProviderRoute from "./routes/provider.routes";
import ProviderLocation from "./routes/providerLocation.routes";
import RequestRoute from "./routes/request.routes";

// Error handler middleware
import { errorHandler } from "./middlewares/error.middleware";

const app = express();
const httpServer = createServer(app); // create HTTP server

// Initialize Socket.io
export const socketServer = createSocketServer(httpServer);

app.get('/socket.io/', (req,res) => {
    res.send('Socket.IO endpoint');
})

app.get('/debug', (req, res) => {
    res.json({
        status: 'ok',
        env: {
            node_env: process.env.NODE_ENV,
            cors_origin: process.env.CORS_ORIGIN
        }
    });
});


// Middleware
app.use(cors({
    origin: `${process.env.CORS_ORIGIN}`,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

//Body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Initialize databases
async function initializeDatabases() {
    try {
        // Connect to MongoDB
        const mongoConnection = await connectDB();
        if (mongoConnection) {
            console.log('✅ MongoDB initialized successfully');
        } else {
            console.log('⚠️ MongoDB initialization failed');
        }

        // Connect to Redis
        const redisConnection = await connectRedis();
        if (redisConnection) {
            console.log('✅ Redis initialized successfully');
        } else {
            console.log('⚠️ Redis initialization failed');
        }
    } catch (error) {
        console.error('❌ Database initialization error:', error);
        process.exit(1);
    }
}

// API Routers
app.use("/nearBy", AuthRoute, ProviderRoute, ProviderLocation, RequestRoute);

// 404 handler
app.use('*', (req: Request, res: Response) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

// Graceful shutdown handler
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    await disconnectRedis();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received. Shutting down gracefully...');
    await disconnectRedis();
    process.exit(0);
});


// Start Server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await initializeDatabases();

        httpServer.listen(PORT, () => {
            console.info(`
              🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}
              👉 http://localhost:${PORT}
            `);
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

startServer().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

export default app;