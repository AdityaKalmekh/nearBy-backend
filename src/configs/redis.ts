import Redis, { RedisOptions } from "ioredis";
let redisClient: Redis | null = null;

export default async function connectRedis() {
    try {

        const options: RedisOptions = {
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT),
            retryStrategy(times: number) {
                if (times > 3) return null;
                return Math.min(times * 100, 2000);
            },
            maxRetriesPerRequest: 1,
            connectTimeout: 10000,
            lazyConnect: true,
            reconnectOnError: (err) => {
                const recoverable = [
                    'READONLY',
                    'ETIMEDOUT',
                    'ECONNREFUSED',
                    'ECONNRESET'
                ];
                
                for (const errType of recoverable) {
                    if (err.message.includes(errType)) {
                        return true;
                    }
                }
                return false;
            },
        };

        // Add authentication only if password is provided
        // For production/cloud Redis, include both username and password
        if (process.env.NODE_ENV === 'production' && process.env.REDIS_PASSWORD) {
            options.username = process.env.REDIS_USERNAME || 'default';
            options.password = process.env.REDIS_PASSWORD;
        }

        // Close existing connection if any
        if (redisClient) {
            await redisClient.quit();
            redisClient = null;
        }

        console.log(`Creating new Redis instance in ${process.env.NODE_ENV} environment...`);
        redisClient = new Redis(options);

        // Enhanced error handling and logging
        redisClient.on('error', (err) => {
            console.error(`❌ Redis Error:`, {
                message: err.message
            });
        });

        redisClient.on('connect', () => {
            console.log(`✅ Redis Connected`);
        });

        redisClient.on('ready', () => {
            console.log(`✅ Redis Ready`);
        });

        // Explicitly connect
        console.log('Attempting to connect...');
        await redisClient.connect();

        // Test the connection
        console.log('Testing connection with PING...');
        const pingResult = await redisClient.ping();
        console.log('PING result:', pingResult);

        return redisClient;
    } catch (error) {
        console.error('❌ Redis connection failed:', error);
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

// Getter for redis client
export function getRedisClient(): Redis | null {
    return redisClient;
}

// Graceful shutdown function
export async function disconnectRedis() {
    if (redisClient) {
        try {
            await redisClient.quit();
            const environment = process.env.REDIS_URI?.includes('localhost') ? 'Local' : 'Cloud';
            console.log(`Redis ${environment} disconnected successfully`);
        } catch (error) {
            console.error('Error during disconnect:', error);
            redisClient.disconnect(false);
        } finally {
            redisClient = null;
        }
    }
}