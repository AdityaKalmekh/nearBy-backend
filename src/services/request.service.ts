import { getRedisClient } from "../configs/redis";
import { createAppError } from "../errors/errors";
import { ProviderWithDistance, RequestData } from "../types/request.types";
import { notificationService } from "./notification.service";
import { ServiceRequest } from "../models/ServiceRequest";
import { ServiceStatus, ProviderAcceptance, RequesterLocation } from "../types/servicerequest.types";
import { RequestOTP } from "../models/RequestOTP";
import mongoose from "mongoose";

const requestService = () => {
    const redis = getRedisClient();

    if (!redis) {
        throw createAppError("Redis connection is not available");
    }

    const COLLECTION_WINDOW_MS = 3000; // 3 seconds window to collect provider acceptances
    let collectionExpiryInterval: NodeJS.Timeout | null = null;

    const generateOTP = (): string => {
        return Math.floor(1000 + Math.random() * 9000).toString();
    }

    const getExpiryTime = (): Date => {
        return new Date(Date.now() + 60 * 60 * 1000);
    }

    const findNearbyProviders = async (requesterLocation: RequesterLocation) => {
        if (!redis) {
            throw new Error('Redis client is not initialized');
        }

        try {
            const radiusInMeters = 10 * 1000;

            // Search for providers within radius
            const nearbyProviders = await redis.georadius(
                'provider:locations',
                requesterLocation.longitude,
                requesterLocation.latitude,
                radiusInMeters,
                'm',  // specify units as meters
                'WITHCOORD', // return coordinates
                'WITHDIST',  // return distance
                'ASC'        // sort by distance ascending
            );

            if (nearbyProviders.length === 0) {
                return [];
            }

            // Process and enrich the provider data
            const enrichedProviders = await Promise.all(
                (nearbyProviders as [string, string, [string, string]][]).map(async (provider) => {
                    const [providerId, distance, [lng, lat]] = provider;

                    return {
                        providerId,
                        distance: parseFloat(distance), // distance in meters
                        coordinates: {
                            latitude: lat,
                            longitude: lng
                        },
                    };
                })
            );
            return enrichedProviders;
        } catch (error) {
            throw error;
        }
    };

    const createNewServiceRequest = async (data: Omit<RequestData, 'requestId' | 'status' | 'createdAt' | 'attempts'>) => {
        try {
            // const requestId = uuidv4();
            const serviceRequest = await ServiceRequest.create({
                requester: data.userId,
                services: data.services,
                reqLocation: {
                    type: 'Point',
                    coordinates: [data.longitude, data.latitude]
                },
                status: ServiceStatus.PENDING
            })

            const requestId = String(serviceRequest._id);

            const requestData: RequestData = {
                ...data,
                requestId: requestId,
                status: 'PENDING',
                createdAt: Date.now(),
                attempts: 0
            };

            await redis.multi()
                .hset(`request:${requestId}`, {
                    attempts: 0,
                    status: ServiceStatus.PENDING
                })
                .expire(`request:${requestId}`, 3600)
                .exec();

            return requestData;
        } catch (error) {
            throw error;
        }
    }

    const startProviderSearch = async (requestData: RequestData) => {
        try {
            // Find nearby providers based on requester location
            const location = {
                longitude: requestData.longitude,
                latitude: requestData.latitude
            };

            const providers = await findNearbyProviders(location);

            if (!providers || providers.length === 0) {
                // No providers available
                await handleNoProvidersAvailable(requestData.requestId, requestData.userId);
                return false;
            }

            const providerQueue = providers.map(p => ({
                providerId: p.providerId,
                distance: p.distance
            }));


            await Promise.all([
                ServiceRequest.findByIdAndUpdate(requestData.requestId, {
                    availableProviders: providerQueue,
                    status: ServiceStatus.SEARCHING
                }),

                // Store provider queue in Redis
                redis.set(
                    `request:${requestData.requestId}:available_providers`,
                    JSON.stringify(providerQueue),
                    'EX',
                    1800
                ),

                // Set request timeout (30 seconds)
                redis.set(
                    `request:${requestData.requestId}:timeout`,
                    'true',
                    'EX',
                    30
                ),

                // Update request status in Redis
                redis.hset(`request:${requestData.requestId}`, {
                    status: ServiceStatus.SEARCHING
                })
            ])

            // Broadcast request to all available providers simultaneously
            await broadcastRequestToProviders(requestData.requestId, requestData.userId, providers);

            // Set up timeout handler to check for responses
            setupRequestTimeout(requestData.requestId, requestData.userId);

            return true;

        } catch (error) {
            console.error("Error starting provider search: ",);
            throw createAppError('Failed to start provider search');
        }
    };

    // Check periodically for expired collection windows
    const setupCollectionExpiryChecker = () => {
        const checkInterval = 1000; // Check every 1 second

        // Clear any existing interval
        if (collectionExpiryInterval) {
            clearInterval(collectionExpiryInterval);
        }

        // Set up new interval
        collectionExpiryInterval = setInterval(async () => {
            try {
                // Get all keys matching the pattern for collection end markers
                const keys = await redis.keys(`request:*:collection_end`);

                if (keys && keys.length > 0) {
                    console.log(`Found ${keys.length} collection windows that may need processing`);

                    // Process each expired collection window
                    for (const key of keys) {
                        try {
                            const requestId = key.split(':')[1];
                            const status = await redis.hget(`request:${requestId}`, 'status');

                            if (status === ServiceStatus.COLLECTION) {
                                console.log(`Processing expired collection window for request ${requestId}`);
                                const userId = await redis.hget(`request:${requestId}`, 'userId');

                                if (userId) {
                                    await processCollectedAcceptances(requestId, userId);
                                } else {
                                    console.error(`No userId found for request ${requestId}`);
                                }
                            }

                            // Delete the key regardless of status to prevent reprocessing
                            await redis.del(key);
                        } catch (err) {
                            console.error(`Error processing collection expiry for key ${key}:`, err);
                        }
                    }
                }
            } catch (error) {
                console.error("Error checking for expired collection windows:", error);
            }
        }, checkInterval);

        return collectionExpiryInterval;
    };

    const broadcastRequestToProviders = async (
        requestId: string,
        userId: string,
        providers: ProviderWithDistance[]
    ) => {
        try {
            // Create a lightweight request data object for notifications
            const requestData = {
                requestId,
                userId
            };

            // Create a set of active providers for this request in Redis
            const activeProviderIds = providers.map(p => p.providerId);

            // Store active providers for this request with TTL (30 seconds)
            await redis.multi()
                .sadd(`request:${requestId}:active_providers`, ...activeProviderIds)
                .expire(`request:${requestId}:active_providers`, 30)
                .exec();

            // Send notifications to all providers simultaneously
            const notificationPromises = providers.map(provider =>
                notificationService().notifyProvider(
                    provider.providerId,
                    'new:request',
                    {
                        ...requestData,
                        distance: provider.distance
                    }
                )
            );

            await Promise.all(notificationPromises);

            return true;
        } catch (error) {
            console.error("Error broadcasting request to providers:", error);
            throw createAppError("Failed to broadcast request to providers");
        }
    };

    const setupRequestTimeout = (requestId: string, userId: string) => {
        setTimeout(async () => {
            try {
                // Check if request is still active in SEARCHING or COLLECTION state
                const status = await redis.hget(`request:${requestId}`, 'status');

                if (status === ServiceStatus.SEARCHING || status === ServiceStatus.COLLECTION) {
                    // If in collection phase, process the collected acceptances if any
                    if (status === ServiceStatus.COLLECTION) {
                        const collectedAcceptances = await processCollectedAcceptances(requestId, userId);

                        // If processing acceptances succeeded, we're done
                        if (collectedAcceptances) {
                            return;
                        }
                    }

                    // No provider accepted the request within timeout
                    await handleNoProvidersAvailable(requestId, userId);
                }
            } catch (error) {
                console.error("Error in request timeout handler:", error);
            }
        }, 30000); // 30 seconds timeout
    };

    const handleProviderResponse = async (requestId: string, providerId: string, accepted: boolean, userId: string) => {
        try {
            // Check if request is still active and this provider is eligible
            const [status, isActiveProvider] = await Promise.all([
                redis.hget(`request:${requestId}`, 'status'),
                redis.sismember(`request:${requestId}:active_providers`, providerId)
            ]);

            // Verify the request is in SEARCHING or COLLECTION state
            if (status !== ServiceStatus.SEARCHING && status !== ServiceStatus.COLLECTION) {
                return {
                    success: false,
                    status: 'REQUEST_ALREADY_HANDLED',
                    message: 'This request has already been handled'
                };
            }

            // Verify this provider is eligible to respond
            if (!isActiveProvider) {
                console.log(`Provider ${providerId} is not authorized for request ${requestId}`);
                return {
                    success: false,
                    status: 'NOT_AUTHORIZED',
                    message: 'Not authorized to respond to this request'
                };
            }

            if (accepted) {
                return await handleAcceptance(requestId, providerId, userId);
            } else {
                await redis.srem(`request:${requestId}:active_providers`, providerId);

                // Check if any providers remain active
                const remainingProviders = await redis.scard(`request:${requestId}:active_providers`);

                if (remainingProviders === 0) {
                    await handleNoProvidersAvailable(requestId, userId);
                }

                return {
                    success: true,
                    status: 'REJECTED',
                    message: 'Request rejected successfully'
                };
            }
        } catch (error) {
            console.error("Error handling provider response:", error);
            throw createAppError("Failed to process provider response");
        }
    };

    const handleAcceptance = async (requestId: string, providerId: string, userId: string) => {
        try {
            // Watch the request status key for changes
            await redis.watch(`request:${requestId}`);

            // Get current request status
            const status = await redis.hget(`request:${requestId}`, 'status');

            // If already in COLLECTION state, just add this provider to the acceptances
            if (status === ServiceStatus.COLLECTION) {
                // Unwatch since we're not doing a transaction
                await redis.unwatch();
                await addProviderAcceptance(requestId, providerId);

                return {
                    success: true,
                    status: 'PROCESSING',
                    message: 'Your acceptance is being processed'
                };
            }

            // If in SEARCHING state, try to transition to COLLECTION with a transaction
            if (status === ServiceStatus.SEARCHING) {
                console.log(`Attempting to transition request ${requestId} to COLLECTION state`);

                // Create a transaction to change the status atomically
                const tx = redis.multi();
                tx.hset(`request:${requestId}`, 'status', ServiceStatus.COLLECTION);
                tx.hset(`request:${requestId}`, 'userId', userId);

                // Execute the transaction - this will fail if the watched key changed
                const result = await tx.exec();

                // Check if transaction succeeded
                if (!result || result.length === 0) {
                    await redis.unwatch();

                    // Retry the operation since status likely changed to COLLECTION
                    return await handleAcceptance(requestId, providerId, userId);
                }

                // Add this provider to acceptances
                await addProviderAcceptance(requestId, providerId);

                // Method 1: Use setTimeout with explicit error handling
                setTimeout(async () => {
                    try {
                        console.log(`Collection window ended for request ${requestId}, processing acceptances`);
                        const processed = await processCollectedAcceptances(requestId, userId);
                        console.log(`Collection processing completed for request ${requestId}, result: ${processed}`);
                    } catch (err) {
                        console.error(`Error in setTimeout callback for request ${requestId}:`, err);
                    }
                }, COLLECTION_WINDOW_MS);

                // Method 2: Also set a Redis key with expiry as a backup mechanism
                await redis.set(
                    `request:${requestId}:collection_end`,
                    'true',
                    'PX',
                    COLLECTION_WINDOW_MS + 1000 // Add 1 second buffer
                );

                return {
                    success: true,
                    status: 'PROCESSING',
                    message: 'Your acceptance is being processed'
                };
            } else {
                // Unwatch since we're not doing a transaction
                await redis.unwatch();

                // Request is in some other state that doesn't allow acceptance
                console.log(`Request ${requestId} is in invalid state for acceptance: ${status}`);
                return {
                    success: false,
                    status: 'INVALID_STATE',
                    message: 'This request is no longer available'
                };
            }
        } catch (error) {
            // Make sure to unwatch in case of errors
            try {
                await redis.unwatch();
            } catch (e) {
                // Ignore error from unwatch
            }

            console.error(`Error handling acceptance for request ${requestId}:`, error);
            throw createAppError("Failed to process acceptance");
        }
    };

    // Add a provider to the acceptances list with their distance
    const addProviderAcceptance = async (requestId: string, providerId: string) => {
        try {
            console.log(`Adding provider ${providerId} to acceptances for request ${requestId}`);

            // Get provider's distance from available providers list
            const availableProvidersStr = await redis.get(`request:${requestId}:available_providers`);

            if (!availableProvidersStr) {
                console.error(`Available providers data not found for request ${requestId}`);
                throw createAppError('Provider data not found');
            }

            const availableProviders = JSON.parse(availableProvidersStr) as ProviderWithDistance[];
            const provider = availableProviders.find(p => p.providerId === providerId);

            if (!provider) {
                console.error(`Provider ${providerId} not found in available providers for request ${requestId}`);
                throw createAppError('Provider not found in available providers');
            }

            // Create acceptance record
            const acceptance: ProviderAcceptance = {
                providerId,
                distance: provider.distance,
                timestamp: Date.now()
            };

            // Add to acceptances list - make sure the key exists with a reasonable expiry
            await redis.multi()
                .sadd(`request:${requestId}:acceptances`, JSON.stringify(acceptance))
                .expire(`request:${requestId}:acceptances`, 60) // 1 minute TTL
                .exec();

            console.log(`Successfully added provider ${providerId} to acceptances with distance ${provider.distance}`);

            return true;
        } catch (error) {
            console.error(`Error adding provider acceptance for request ${requestId}:`, error);
            throw error;
        }
    };

    const processCollectedAcceptances = async (requestId: string, userId: string) => {
        try {
            console.log(`Processing collected acceptances for request ${requestId}`);

            // Use a lock to prevent multiple processes from handling the same request
            const lockAcquired = await redis.set(
                `request:${requestId}:processing_lock`,
                '1',
                'EX',
                10,
                'NX' // 10 second lock
            );

            if (!lockAcquired) {
                console.log(`Another process is already handling acceptances for request ${requestId}`);
                return false;
            }

            // Check if request is still in COLLECTION state
            const status = await redis.hget(`request:${requestId}`, 'status');
            console.log(`Current status for request ${requestId} when processing acceptances: ${status}`);

            if (status !== ServiceStatus.COLLECTION) {
                console.log(`Request ${requestId} is no longer in COLLECTION state, skipping processing`);
                await redis.del(`request:${requestId}:processing_lock`);
                return false;
            }

            // Get all collected acceptances
            const acceptancesSet = await redis.smembers(`request:${requestId}:acceptances`);
            console.log(`Found ${acceptancesSet?.length || 0} acceptances for request ${requestId}`);

            if (!acceptancesSet || acceptancesSet.length === 0) {
                console.log(`No acceptances collected for request ${requestId}, handling no providers`);
                await redis.del(`request:${requestId}:processing_lock`);
                await handleNoProvidersAvailable(requestId, userId);
                return false;
            }

            // Parse the acceptances
            const acceptances: ProviderAcceptance[] = [];
            for (const acceptanceStr of acceptancesSet) {
                try {
                    const acceptance = JSON.parse(acceptanceStr);
                    acceptances.push(acceptance);
                    console.log(`Parsed acceptance: Provider ${acceptance.providerId}, Distance ${acceptance.distance}`);
                } catch (err) {
                    console.error(`Error parsing acceptance JSON for request ${requestId}:`, err);
                }
            }

            if (acceptances.length === 0) {
                console.log(`No valid acceptances found for request ${requestId}, handling no providers`);
                await redis.del(`request:${requestId}:processing_lock`);
                await handleNoProvidersAvailable(requestId, userId);
                return false;
            }

            // Find the provider with the shortest distance
            let nearestProvider = acceptances[0];
            for (const acceptance of acceptances) {
                if (acceptance.distance < nearestProvider.distance) {
                    nearestProvider = acceptance;
                }
            }

            console.log(`Selected nearest provider ${nearestProvider.providerId} with distance ${nearestProvider.distance} for request ${requestId}`);

            // Proceed with accepting this provider
            await finalizeProviderAcceptance(requestId, nearestProvider.providerId, userId, acceptances);

            // Release the lock
            await redis.del(`request:${requestId}:processing_lock`);

            return true;
        } catch (error) {
            console.error(`Error processing collected acceptances for request ${requestId}:`, error);

            // Release the lock in case of error
            try {
                await redis.del(`request:${requestId}:processing_lock`);
            } catch (e) {
                // Ignore error from lock release
            }

            // If there's an error, try to reset the state to give providers another chance
            try {
                await redis.hset(`request:${requestId}`, 'status', ServiceStatus.SEARCHING);
                console.log(`Reset request ${requestId} to SEARCHING state due to error`);
            } catch (err) {
                console.error(`Failed to reset state for request ${requestId}:`, err);
            }

            throw error;
        }
    };

    // Finalize the acceptance for the selected provider
    const finalizeProviderAcceptance = async (
        requestId: string,
        providerId: string,
        userId: string,
        allAcceptances: ProviderAcceptance[]
    ) => {
        try {
            console.log(`Finalizing acceptance for request ${requestId} with provider ${providerId}`);

            // Update request status to ACCEPTED
            await redis.hset(`request:${requestId}`, {
                'status': ServiceStatus.ACCEPTED,
                'currentProvider': providerId
            });

            // Get provider's current location
            console.log(`Getting location for provider ${providerId}`);
            // let coordinates;
            // try {
            //     coordinates = await getProviderLocationFromGeo(providerId);
            //     console.log(`Provider ${providerId} coordinates:`, coordinates);
            // } catch (err) {
            //     console.error(`Error getting provider location for ${providerId}:`, err);
            //     // Continue without coordinates if we can't get them
            // }
            const coordinates = await getProviderLocationFromGeo(providerId);

            // Generate OTP for verification
            const otp = generateOTP();
            const expiresAt = getExpiryTime();
            console.log(`Generated OTP ${otp} for request ${requestId}`);

            // Create OTP record
            const requestOTP = new RequestOTP({
                serviceRequest: requestId,
                provider: providerId,
                requester: userId,
                otp,
                expiresAt
            });

            await requestOTP.save();
            console.log(`Saved OTP record for request ${requestId}`);

            // Store all acceptances for analytics
            await redis.set(
                `request:${requestId}:accepted_providers`,
                JSON.stringify(allAcceptances),
                'EX',
                3600 // Keep for 1 hour
            );

            // Update database and clean up Redis in parallel
            console.log(`Updating database and sending notifications for request ${requestId}`);

            const updatePromises = [
                // Update service request in database
                ServiceRequest.findByIdAndUpdate(
                    requestId,
                    {
                        status: ServiceStatus.ACCEPTED,
                        provider: providerId,
                        searchAttempts: await redis.hget(`request:${requestId}`, 'attempts') || 0,
                        prvLocation: coordinates ? {
                            type: 'Point',
                            coordinates: [coordinates.longitude, coordinates.latitude]
                        } : undefined,
                        otpGenerated: true,
                        acceptedProviders: allAcceptances
                    }
                ),

                // Clean up Redis keys
                redis.multi()
                    .del(`request:${requestId}:timeout`)
                    .del(`request:${requestId}:acceptances`)
                    .del(`request:${requestId}:collection_end`)
                    .expire(`request:${requestId}`, 3600) // Keep for 1 hour
                    .exec(),

                // Notify the selected provider they got the request
                notificationService().notifyProvider(
                    providerId,
                    'request:accepted',
                    requestId,
                ),

                // Notify the requester that their request was accepted
                notificationService().notifyRequester(
                    userId,
                    'ACCEPTED',
                    requestId
                )
            ];

            await Promise.all(updatePromises);
            console.log(`Successfully updated database and sent notifications for request ${requestId}`);

            // Notify all other providers their acceptances were declined
            await notifyOtherProviders(requestId, providerId, allAcceptances);

            return true;
        } catch (error) {
            console.error(`Error finalizing provider acceptance for request ${requestId}:`, error);
            throw error;
        }
    };

    const handleNoProvidersAvailable = async (requestId: string, userId: string) => {
        try {
            console.log(`Handling no providers available for request ${requestId}`);

            // Get attempts count for record-keeping
            const attempts = await redis.hget(`request:${requestId}`, 'attempts');

            // Clean up Redis and update database
            await Promise.all([
                redis.multi()
                    .del(`request:${requestId}`)
                    .del(`request:${requestId}:available_providers`)
                    .del(`request:${requestId}:active_providers`)
                    .del(`request:${requestId}:acceptances`)
                    .del(`request:${requestId}:collection_end`)
                    .del(`request:${requestId}:timeout`)
                    .exec(),

                ServiceRequest.findByIdAndUpdate(requestId, {
                    status: ServiceStatus.NO_PROVIDER,
                    searchAttempts: attempts || 0
                })
            ]);

            // Notify requester that no providers accepted
            await notificationService().notifyRequester(userId, 'NO_PROVIDER', requestId);
            console.log(`Notified requester ${userId} that no providers accepted request ${requestId}`);

            return true;
        } catch (error) {
            console.error(`Error handling no providers available for request ${requestId}:`, error);
            throw createAppError("Failed to handle no providers case");
        }
    };

    // Notify all other providers who accepted that they didn't get the request
    const notifyOtherProviders = async (
        requestId: string,
        acceptedProviderId: string,
        allAcceptances: ProviderAcceptance[]
    ) => {
        try {
            // Get all providers who accepted except the chosen one
            const otherProviders = allAcceptances
                .filter(a => a.providerId !== acceptedProviderId)
                .map(a => a.providerId);

            if (otherProviders.length === 0) {
                console.log(`No other providers to notify for request ${requestId}`);
                return;
            }

            console.log(`Notifying ${otherProviders.length} other providers that request ${requestId} was assigned to another provider`);

            // Send notifications to all other providers who accepted
            const notificationPromises = otherProviders.map(providerId =>
                notificationService().notifyProvider(
                    providerId,
                    'request:unavailable',    
                    requestId
                )
            );

            await Promise.all(notificationPromises);

            // Also notify any remaining active providers who haven't yet responded
            const activeProviders = await redis.smembers(`request:${requestId}:active_providers`);

            if (activeProviders && activeProviders.length > 0) {
                const remainingProviders = activeProviders.filter(pid =>
                    pid !== acceptedProviderId && !otherProviders.includes(pid)
                );

                if (remainingProviders.length > 0) {
                    console.log(`Notifying ${remainingProviders.length} remaining active providers that request ${requestId} is no longer available`);

                    const remainingNotifications = remainingProviders.map(providerId =>
                        notificationService().notifyProvider(
                            providerId,
                            'request:unavailable',
                            requestId
                        )
                    );

                    await Promise.all(remainingNotifications);
                }
            }

            // Clear the active providers set
            await redis.del(`request:${requestId}:active_providers`);

            return true;
        } catch (error) {
            console.error("Error notifying other providers:", error);
            // Non-critical operation, don't throw
        }
    };

    const getProviderLocationFromGeo = async (providerId: string): Promise<RequesterLocation | null> => {
        try {
            const coordinates = await redis.geopos('provider:locations', providerId);
            if (!coordinates || !coordinates[0] || coordinates[0].length !== 2) {
                throw createAppError('Provider Location data not found in redis');
            }

            const [long, lat] = coordinates[0];
            return {
                longitude: parseFloat(long),
                latitude: parseFloat(lat)
            }
        } catch (error) {
            console.error("Error getting provider location:", error);
            throw error;
        }
    }


    const getServiceRequestDetails = async (requestId: string) => {
        try {
            const result = await ServiceRequest.aggregate([
                // Match only using requestId
                {
                    $match: {
                        _id: new mongoose.Types.ObjectId(requestId)
                    }
                },
                // Join with providers collection
                {
                    $lookup: {
                        from: "providers",
                        localField: "provider",
                        foreignField: "_id",
                        as: "providerInfo"
                    }
                },
                // Unwind provider array
                {
                    $unwind: "$providerInfo"
                },
                // Join with users collection using provider's userId
                {
                    $lookup: {
                        from: "users",
                        localField: "providerInfo.userId",
                        foreignField: "_id",
                        as: "userInfo"
                    }
                },
                // Unwind users array
                {
                    $unwind: "$userInfo"
                },
                // Join with requestotps collection
                {
                    $lookup: {
                        from: "requestotps",
                        let: {
                            requestId: "$_id",
                            providerId: "$provider"
                        },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ["$serviceRequest", "$$requestId"] },
                                            { $eq: ["$provider", "$$providerId"] }
                                        ]
                                    }
                                }
                            },
                            // Sort by createdAt to get the latest OTP if multiple exist
                            { $sort: { createdAt: -1 } },
                            { $limit: 1 }
                        ],
                        as: "otpInfo"
                    }
                },
                // Unwind OTP array (optional, will be null if no OTP exists)
                {
                    $unwind: {
                        path: "$otpInfo",
                        preserveNullAndEmptyArrays: true
                    }
                },
                // Project only the required fields
                {
                    $project: {
                        _id: 0,
                        prvLocation: 1,
                        reqLocation: 1,
                        "userInfo.firstName": 1,
                        "userInfo.lastName": 1,
                        "userInfo.email": 1,
                        "userInfo.phoneNo": 1,
                        "otpInfo.otp": 1
                    }
                }
            ]);

            return result[0] || null;
        } catch (error) {
            console.error('Error fetching service request details:', error);
            throw error;
        }
    }

    const getRequesterDetails = async (requestId: string) => {
        try {
            const result = await ServiceRequest.aggregate([
                {
                    $match: {
                        _id: new mongoose.Types.ObjectId(requestId)
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'requester',
                        foreignField: '_id',
                        as: 'userInfo'
                    }
                },
                {
                    $unwind: "$userInfo"
                },
                {
                    $project: {
                        _id: 0,
                        reqLocation: 1,
                        "userInfo.firstName": 1,
                        "userInfo.lastName": 1,
                        "userInfo.email": 1,
                        "userInfo.phoneNo": 1,
                    }
                }
            ]);

            return result[0] || null;
        } catch (error) {
            throw error;
        }
    }

    setupCollectionExpiryChecker();

    return {
        createNewServiceRequest,
        startProviderSearch,
        handleProviderResponse,
        findNearbyProviders,
        getServiceRequestDetails,
        getRequesterDetails,
        setupRequestTimeout
    }
}

export default requestService;