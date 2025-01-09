import dotenv from 'dotenv';

// Load environment variables once
const loadEnv = () => {
    if (process.env.NODE_ENV !== 'production'){
         // Only try to load .env file in development
        dotenv.config({
            path:'.env.development'
        });
    }
    
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Using database:', process.env.MONGODB_URI?.split(':')[0]); // Logs database without credentials
};

export default loadEnv;