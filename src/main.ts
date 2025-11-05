const loadEnv = require("./configs/env").default;
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
import rateLimitMiddleware from "express-rate-limit";

const app = express();
const httpServer = createServer(app); // create HTTP server

// Define rate limit 
const limiter = rateLimitMiddleware({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: {
        status: 429,
        message: 'Try After Some time.'
    }
})

// Initialize Socket.io
export const socketServer = createSocketServer(httpServer);

const allowedOrigins = [
    'http://localhost:3000',       // Web frontend
    // 'http://localhost:19000',      // Expo development
    // 'http://localhost:19001',      // Expo development alternate
    // 'http://localhost:19002',      // Expo dev tools
    // 'exp://localhost:19000',       // Expo on local device
    // 'exp://192.168.*.*:19000',     // Common Expo LAN addresses
    // 'exp://10.0.*.*:19000',        // More LAN patterns
    // 'https://exp.host',            // Expo hosting
    // Add any production domains if needed
];

// Middleware
app.set("trust proxy", 1);
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie']
}));

// app.use((req, res, next) => {
//     res.header('Access-Control-Allow-Credentials', 'true');
//     res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN);
//     res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
//     res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
//     res.header('Access-Control-Expose-Headers', 'Set-Cookie');
//     next();
// });

//Body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(limiter);

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
app.get("/", (req: Request, res: Response) => {
  res.status(200).send("Backend is running ✅");
});

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