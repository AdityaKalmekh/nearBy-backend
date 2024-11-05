import express from "express";
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
    origin : `${process.env.CORS_ORIGIN}`,
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// API Routers
app.use("/nearBy", AuthRoute);

// Error handler
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.info(`
              🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}
              👉 http://localhost:${PORT}
            `);
        });
    } catch (error) {
        console.error("Failed to start server:",error);
        process.exit(1);
    }
}

startServer().catch((error) =>{
    console.error('❌ Error:', error);
    process.exit(1);
});