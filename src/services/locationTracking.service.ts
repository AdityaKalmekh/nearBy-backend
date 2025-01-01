import { getRedisClient } from "../configs/redis";
import { ProviderLocation } from "../models/ProviderLocation";
import { ObjectId } from "mongodb";
import { createAppError } from "../errors/errors";
import { Provider } from "../models/Provider";
import { calculateDistance } from "../utils/distanceCal.utils";

const createLocationTrackingService = () => {
  const redis = getRedisClient();

  type LocationDetails = {
    longitude: number;
    latitude: number;
    source: string;
    accuracy: number;
  }

  type LocationData = {
    longitude: number,
    latitude: number,
    timestamp: Date,
    accuracy: number,
    updatedAt: Date,
    source: string
  }

  const initializeProviderLocation = async (providerId: string, location: LocationDetails) => {
    const locationData = {
      ...location,
      timestamp: Date.now(),
      updatedAt: new Date()
    };

    if (!redis) {
      throw new Error('Redis client is not initialized');
    }

    const result = await redis.multi()
      .hset(
        `provider:${providerId}`,
        {
          'location': JSON.stringify(locationData),
          'lastUpdate': Date.now(),
          'startTime': Date.now(),
          'status': 'active'
        }
      )
      .geoadd(
        'provider:locations',
        location.longitude,
        location.latitude,
        providerId
      )
      .exec();

    if (!result) {
      throw createAppError(
        `Enable to set data in redis for id ${providerId}`
      )
    }

    const isSuccessful = result.every(([error, value]) =>
      error === null && Number(value) > 0
    );

    return isSuccessful;
  }

  const startShift = async (providerId: string, location: LocationDetails) => {
    try {
      // Check if provider already has an active session
      const MAX_ALLOWED_DISTANCE_KM = 10;
      const existingSession = await redis?.hget(`provider:${providerId}`, 'status');
      if (existingSession === 'active') {
        throw createAppError("Provider already has an active session");
      }

      // Fetch provider's base location from DB
      const providerBaseLocation = await Provider.findById(providerId)
        .select('baseLocation')
        .lean();

      if (!providerBaseLocation?.baseLocation) {
        throw createAppError("Provider base location not found");
      }

      const baseLocation = {
        longitude: providerBaseLocation.baseLocation.coordinates[0],
        latitude: providerBaseLocation.baseLocation.coordinates[1]
      }

      const distance = await calculateDistance(baseLocation, location);

      if (distance > 10) {
        throw createAppError(
          `Current location is outside the allowed radius of ${MAX_ALLOWED_DISTANCE_KM}km from base location. Distance: ${distance.toFixed(2)}km`
        );
      }

      const initializeAck = await initializeProviderLocation(providerId, location);
      if (initializeAck) {
        return { success: true, message: "Location tracking started" }
      }
    } catch (error) {
      throw error;
    }
  };

  const updateProviderLocation = async (providerId: string, location: LocationDetails) => {
    const locationData = {
      ...location,
      timestamp: Date.now(),
      updatedAt: new Date()
    };

    // Only update location-related fields  
    return redis?.multi()
      .hset(
        `provider:${providerId}`,
        'location', JSON.stringify(locationData),
        'lastUpdate', Date.now()
      )
      .geoadd(
        'provider:locations',
        location.longitude,
        location.latitude,
        providerId
      )
      .exec();
  };

  const updateLocation = async (providerId: string, location: LocationDetails) => {
    try {
      // Verify provider has an active session
      const status = await redis?.hget(`provider:${providerId}`, 'status');
      if (status !== 'active') {
        throw createAppError(
          'No active session found'
        );
      }

      await updateProviderLocation(providerId, location);
      return { success: true, message: 'Location updated successfully' };
    } catch (error) {
      throw error;
    }
  };


  const endShift = async (providerId: string) => {
    try {
      
      if (!redis) {
        // throw new Error('Redis client not initialized');
        throw createAppError(
          'Redis client not initialized'
        )
      }
      // Verify there's an active session
      const status = await redis.hget(`provider:${providerId}`, 'status');

      if (status !== 'active') {
        throw createAppError(
          'No active session found'
        )
      }

      const locationData = await redis.hget(`provider:${providerId}`, 'location');

      if (!locationData) {
        throw createAppError(
          'No location data found'
        )
      }

      const parseLocationData: LocationData = JSON.parse(locationData);
      const currentLocationData = {
        currentLocation: {
          type: "Point",
          coordinates: [
            Number(parseLocationData.longitude),
            Number(parseLocationData.latitude)
          ],
          source: parseLocationData.source,
          accuracy: parseLocationData.accuracy,
          lastUpdated: new Date(parseLocationData.updatedAt)
        },
        isActive: false
      }

      // Update MongoDB
      const updateResult = await ProviderLocation.findOneAndUpdate(
        { providerId: new ObjectId(providerId) },
        { $set: currentLocationData },
        { new: true }
      );

      if (!updateResult) {
        throw createAppError(
          'Failed to update provider location in MongoDB'
        )
      }

      // Clean Redis data atomically
      const redisCleanup = await redis.multi()
        .del(`provider:${providerId}`)
        .zrem('provider:locations', providerId)
        .exec();

      if (!redisCleanup?.every(([err]) => !err)) {
        throw createAppError(
          'Failed to cleanup Redis data'
        )
      }

      return {
        success: true,
        message: 'Shift ended successfully'
      };
    } catch (error) {
      throw error;
    }
  };

  return {
    startShift,
    updateLocation,
    endShift,
  };
}

export default createLocationTrackingService;