import dotenv from 'dotenv';

// Load environment variables once
const loadEnv = () => {
    dotenv.config({
        path: process.env.NODE_ENV === 'production' 
            ? '.env.production' 
            : '.env.development'
    });
    
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Using database:', process.env.MONGODB_URI?.split(':')[0]); // Logs database without credentials
};

export default loadEnv;

