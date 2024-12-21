import { getRedisClient } from "../configs/redis";
import { createAppError } from "../errors/errors";

interface Coordinate {
    latitude: number;
    longitude: number;
}

// Haversine formula calculation
const calculateHaversineDistance = (
    point1: Coordinate,
    point2: Coordinate 
): number => {
    
    const R = 6371; // Earth's radius in kilometers
    const dLat = (point2.latitude - point1.latitude) * (Math.PI / 180);
    const dLon = (point2.longitude - point1.longitude) * (Math.PI / 180);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(point1.latitude * (Math.PI / 180)) *
        Math.cos(point2.latitude * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
};

// Redis-based calculation
const redisBasedCalculation = async (
    point1: Coordinate,
    point2: Coordinate
): Promise<number> => {
    const redis = getRedisClient();

    if (!redis) {
        throw createAppError('Redis client is not initialized');
    }

    const tempKey = `temp:locations:${Date.now()}`;

    try {
        // Add both points using multi command
        await redis.multi()
            .geoadd(
                tempKey,
                point1.longitude,
                point1.latitude,
                'point1',
                point2.longitude,
                point2.latitude,
                'point2'
            )
            .exec();

        // Get distance using geodist
        const distanceStr = await redis.geodist(
            tempKey,
            'point1',
            'point2'
        );

        // Convert result to number and handle null case
        return distanceStr ? Number(distanceStr) / 1000 : 0;
    } catch (error) {
        throw error;
    } finally {
        await redis.del(tempKey);
    }
};

// Main function that tries Redis first, falls back to Haversine
export const calculateDistance = async (
    point1: Coordinate,
    point2: Coordinate
): Promise<number> => {
    try {
        // Try Redis calculation first
        return await redisBasedCalculation(point1, point2);
    } catch (error) {
        console.warn('Redis-based distance calculation failed, falling back to Haversine formula', error);
        // Fallback to Haversine calculation
        return calculateHaversineDistance(point1, point2);
    }
};