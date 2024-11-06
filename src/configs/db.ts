import mongoose from "mongoose";
import "dotenv/config";

export default async function connectDB() {
   
    const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
        socketTimeoutMS: 45000, // Close sockets after 45s
        family: 4 // Use IPv4, skip trying IPv6
    };
    try {
       await mongoose.connect(`${process.env.MONGODB_URI}`,options);
    } catch (err) {
        console.log(err);
        process.exit(1);
    }

    const dbConnection = mongoose.connection;

    dbConnection.once("open", () => {
        console.log(`Database connected: ${process.env.MONGODB_URL}`);
    });

    dbConnection.on("error", (err) => {
        console.error(`Connection error: ${err}`);
    });

    return dbConnection;
}