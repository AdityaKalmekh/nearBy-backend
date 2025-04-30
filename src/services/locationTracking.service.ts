import { getRedisClient } from "../configs/redis";
import { ProviderLocation } from "../models/ProviderLocation";
import { ObjectId } from "mongodb";
import { createAppError } from "../errors/errors";
import { Provider } from "../models/Provider";
import { calculateDistance } from "../utils/distanceCal.utils";

interface LocationMetadata {
  startTime?: number;
  lastUpdate: number;
  source: string;
  accuracy: number;
}

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

type CurrentLocationData = {
  currentLocation: {
    type: string;
    coordinates: number[];
    source: string;
    accuracy: number;
    lastUpdated: Date;
  };
  isActive: boolean;
}

const createLocationTrackingService = () => {
  const redis = getRedisClient();
  // Local cache for active provider statuses
  const providerStatusCache = new Map<string, string>();

  const initializeProviderLocation = async (providerId: string, location: LocationDetails) => {

    if (!redis) {
      throw new Error('Redis client is not initialized');
    }

    try {
      const pipeline = redis.pipeline();

      // Add to active providers set with TTL
      pipeline.sadd('active:providers', providerId);

      // Store start time and status in separate key
      pipeline.set(`provider:${providerId}:metadata`, JSON.stringify({
        startTime: Date.now(),
        lastUpdate: Date.now(),
        source: location.source,
        accuracy: location.accuracy
      }));

      // Add to geo index
      pipeline.geoadd(
        'provider:locations',
        location.longitude,
        location.latitude,
        providerId
      );

      // Set expiry for all keys
      pipeline.expire(`provider:${providerId}:metadata`, 7200);
      const results = await pipeline.exec();
      // Update local cache
      providerStatusCache.set(providerId, 'active');
      return results && !results.some(([err]) => err);

    } catch (error: any) {
      console.error(`Redis error in initializeProviderLocation for provider ${providerId}:`, error);
      throw createAppError(`Failed to initialize location tracking: ${error.message}`);
    }
  }

  const startShift = async (providerId: string, location: LocationDetails) => {
    if (!redis) {
      throw createAppError('Redis client is not initialized')
    }

    try {
      // Check if provider is already active (check cache first, then Redis)
      const cachedStatus = providerStatusCache.get(providerId);

      if (!cachedStatus) {
        const isActive = await redis.sismember('active:providers', providerId);
        if (isActive) {
          providerStatusCache.set(providerId, 'active');
          throw createAppError("Provider already has an active session");
        }
      } else if (cachedStatus === 'active') {
        throw createAppError("Provider already has an active session");
      }

      const MAX_ALLOWED_DISTANCE_KM = 10;

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

      if (distance > MAX_ALLOWED_DISTANCE_KM) {
        throw createAppError(
          `Current location is outside the allowed radius of ${MAX_ALLOWED_DISTANCE_KM}km from base location. Distance: ${distance.toFixed(2)}km`
        );
      }

      const initializeAck = await initializeProviderLocation(providerId, location);
      if (initializeAck) {
        return { success: true, message: "Location tracking started" }
      } else {
        throw createAppError("Failed to initialize location tracking");
      }
    } catch (error) {
      providerStatusCache.delete(providerId);
      throw error;
    }
  };

  const endShift = async (providerId: string) => {
    try {
      if (!redis) {
        throw createAppError('Redis client not initialized');
      }
      
      // Check if provider is active
      let isActive: number | boolean;
      if (providerStatusCache.has(providerId)) {
        isActive = providerStatusCache.get(providerId) === 'active';
      } else {
        isActive = await redis.sismember('active:providers', providerId);
      }
   
      if (!isActive) {
        throw createAppError('No active session found');
      }

      // Get current coordinates and metadata
      const [currentCoords, metadata] = await Promise.all([
        redis.geopos('provider:locations', providerId),
        redis.get(`provider:${providerId}:metadata`)
      ]);

      if (!currentCoords || !currentCoords[0]) {
        throw createAppError('No location data found');
      }

      try {
        const [longitude, latitude] = currentCoords[0];
        const metadataObj: LocationMetadata = metadata ? JSON.parse(metadata) : {
          lastUpdate: Date.now(),
          source: 'unknown',
          accuracy: 0
        };

        // Prepare data for MongoDB
        const currentLocationData: CurrentLocationData = {
          currentLocation: {
            type: "Point",
            coordinates: [
              Number(longitude),
              Number(latitude)
            ],
            source: metadataObj.source || 'unknown',
            accuracy: metadataObj.accuracy || 0,
            lastUpdated: new Date(metadataObj.lastUpdate || Date.now())
          },
          isActive: false
        };

        // Update MongoDB
        const updatePromise = ProviderLocation.findOneAndUpdate(
          { providerId: new ObjectId(providerId) },
          { $set: currentLocationData },
          { new: true }
        );

        // Clean Redis data
        const cleanupPipeline = redis.pipeline();
        cleanupPipeline.srem('active:providers', providerId);
        cleanupPipeline.zrem('provider:locations', providerId);
        cleanupPipeline.del(`provider:${providerId}:metadata`);

        const [mongoResult, redisResult] = await Promise.all([
          updatePromise,
          cleanupPipeline.exec()
        ]);

        if (!mongoResult) {
          console.error(`Failed to update provider location in MongoDB for provider ${providerId}`);
        }

        // Clean local cache
        providerStatusCache.delete(providerId);

        return {
          success: true,
          message: 'Shift ended successfully'
        };
      } catch (error) {
        console.error(`Error processing end shift for provider ${providerId}:`, error);
        throw createAppError(`Failed to process end shift: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } catch (error) {
      providerStatusCache.delete(providerId);
      throw error;
    }
  }

  return {
    startShift,
    endShift,
  };
}

export default createLocationTrackingService;