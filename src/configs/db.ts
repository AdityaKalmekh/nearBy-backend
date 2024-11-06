import mongoose from "mongoose";
import "dotenv/config";

export default async function connectDB() {

    try {
        if (!process.env.MONGODB_URI) {
            console.error('MONGODB_URI is not defined');
            return null;
        }

        // Remove any existing connections
        if (mongoose.connections.length > 0) {
            const connection = mongoose.connections[0];
            if (connection.readyState !== 0) {
                await connection.close();
            }
        }

        const options = {
            serverSelectionTimeoutMS: 30000, // Timeout after 5s instead of 30s
            maxPoolSize: 10,
            minPoolSize: 5,
            socketTimeoutMS: 45000, // Close sockets after 45s
            family: 4,// Use IPv4, skip trying IPv6
            retryWrites: true,
            W: 'majority'
        };

        console.log("Connecting to mongodb");

        const conn = await mongoose.connect(`${process.env.MONGODB_URI}`, options);

        mongoose.connection.on('connected', () => {
            console.log(`MongoDB Connected: ${conn.connection.host}`);
        });

        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('MongoDB disconnected');
        });

        return conn;

    } catch (error) {
        console.error('MongoDB connection error:', error);
        if (error instanceof Error) {
            console.error({
                errorName: error.name,
                errorMessage: error.message,
                stack: error.stack
            });
        }
        return null;
    }
}