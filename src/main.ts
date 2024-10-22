import express, {Request,Response} from "express";
import cors from "cors"
import bodyParser from "body-parser";
import "dotenv/config";
import connectDB from "./config/db";

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

connectDB();

app.get('/', (req: Request, res: Response) => {
    res.json({ message: 'Hello from TypeScript backend!' });
});

app.listen(PORT, () => {
    console.info(`Server up on port ${PORT}`);
});