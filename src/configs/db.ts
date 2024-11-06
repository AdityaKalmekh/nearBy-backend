import mongoose from "mongoose";
import "dotenv/config";

export default async function connectDB() {
   
    try {
       await mongoose.connect(`${process.env.MONGODB_URI}`);
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