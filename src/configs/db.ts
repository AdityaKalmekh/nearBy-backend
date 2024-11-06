import mongoose from "mongoose";
import "dotenv/config";

export default async function connectDB() {
    try {
        if (!process.env.MONGODB_URI) {
            console.error('MONGODB_URI is not defined');
            return null;
        }

        console.log(`Attempting to connect to ${process.env.NODE_ENV} database...`);

        // Remove any existing connections
        if (mongoose.connections.length > 0) {
            const connection = mongoose.connections[0];
            if (connection.readyState !== 0) {
                await connection.close();
            }
        }

        mongoose.connection.on('connected', () => {
            console.log('✅ MongoDB Connected:', mongoose.connection.host);
        });

        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('⚠️ MongoDB disconnected');
        });

        // Connect to MongoDB
        const options = {
            serverSelectionTimeoutMS: 30000, // Timeout after 5s instead of 30s
            maxPoolSize: 10,
            minPoolSize: 5,
            socketTimeoutMS: 45000, // Close sockets after 45s
            family: 4,// Use IPv4, skip trying IPv6
            retryWrites: true,
            W: 'majority'
        };

        const conn = await mongoose.connect(`${process.env.MONGODB_URI}`, options);

        //Test the connection
        await mongoose.connection.db?.admin().ping();
        console.log('🎉 Database connection test successful!');

        return conn;
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        if (error instanceof Error) {
            console.error({
                errorName: error.name,
                errorMessage: error.message,
                stack: error.stack
            });
        }
        return null;
    } finally {
        // Additional connection status check
        const state = mongoose.connection.readyState;
        const states = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting'
        };
        console.log('📊 Connection state:', states[state] || 'unknown');
    }
}