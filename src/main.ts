import loadEnv from "./configs/env";
loadEnv();

import express, { Request, Response } from "express";
import cors from "cors"
import bodyParser from "body-parser";
import connectDB from "./configs/db";
import cookieParser from "cookie-parser";

// Import routes
import AuthRoute from "./routes/auth.routes"

// Error handler middleware
import { errorHandler } from "./middlewares/error.middleware";

const app = express();

// Middleware
app.use(cors({
    origin: `${process.env.CORS_ORIGIN}`,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']
}));

//Body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

connectDB()
    .then((connection) => {
        if (connection) {
            console.log('✅ Database initialized successfully');
        } else {
            console.log('⚠️ Database initialization failed');
        }
    })
    .catch((error) => {
        console.error('❌ Unexpected error:', error);
    });


// API Routers
app.use("/nearBy", AuthRoute);

// 404 handler
app.use('*', (req: Request, res: Response) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        app.listen(PORT, () => {
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