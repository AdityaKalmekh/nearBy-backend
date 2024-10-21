import express from "express";
import cors from "cors"
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));

const PORT = process.env.PORT || 3000;

app.listen(PORT, ()=>{
    console.info(`Server up on port ${PORT}`);
});