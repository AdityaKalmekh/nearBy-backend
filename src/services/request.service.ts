import { getRedisClient } from "../configs/redis";
import { createAppError } from "../errors/errors";
import { ProviderWithDistance, RequestData } from "../types/request.types";
import { notificationService } from "./notification.service";
import { ServiceRequest } from "../models/ServiceRequest";
import { ServiceStatus } from "../types/servicerequest.types";
import { Provider } from "../models/Provider";
import { User } from "../models/User";
import { RequestOTP } from "../models/RequestOTP";
import { IUser } from "../types/user.types";
import { IRequestOTP } from "../types/requestOTP.types";
import mongoose from "mongoose";

const requestService = () => {
    const redis = getRedisClient();

    if (!redis) {
        throw createAppError("Redis connection is not available");
    }

    interface RequesterLocation {
        longitude: number;
        latitude: number;
    }

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

            // const redisRequestData = {
            //     currentProvider: requestData.currentProvider,
            //     attempts: requestData.attempts,
            //     status: requestData.status
            // }

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

    // const processNextProvider = async (requestId: string, userId: string) => {
    //     try {
    //         // 1. Get provider queue
    //         const queueStr = await redis.get(`request:${requestId}:provider_queue`);
    //         if (!queueStr) {
    //             await handleNoProvidersAvailable(requestId, userId);
    //             return false;
    //         }
    //         const queue = JSON.parse(queueStr) as ProviderWithDistance[];

    //         // 2. Get next provider
    //         const nextProvider = queue.shift();

    //         if (!nextProvider) {
    //             await handleNoProvidersAvailable(requestId, userId);
    //             return false;
    //         }

    //         await redis.multi()
    //             .set(`request:${requestId}:provider_queue`, JSON.stringify(queue))
    //             .hset(`request:${requestId}`, {
    //                 'currentProvider': nextProvider.providerId
    //             })
    //             .hincrby(`request:${requestId}`, 'attempts', 1)
    //             .set(`request:${requestId}:timeout`, 'true', 'EX', 22)
    //             .exec();

    //         const requestData = {
    //             userId,
    //             distance: nextProvider.distance,
    //             requestId
    //         }

    //         await notificationService().notifyProvider(nextProvider.providerId, 'new:request', requestData);
    //         setupTimeout(nextProvider.providerId, requestId, userId);
    //         return true;
    //     } catch (error) {
    //         throw createAppError("Failed to process next provider");
    //     }
    // };

    // Broadcast request to all available providers simultaneously

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

    // const setupTimeout = (providerId: string, requestId: string, userId: string) => {
    //     setTimeout(async () => {
    //         // 1. Check if timeout is still valid
    //         const timeoutExists = await redis.get(`request:${requestId}:timeout`);
    //         if (!timeoutExists) {
    //             return; // Request was already handled
    //         }

    //         // 2. Verify current provider
    //         const currentProvider = await redis.hget(`request:${requestId}`, 'currentProvider');
    //         if (currentProvider !== providerId) {
    //             return; // Another provider is handling
    //         }

    //         // 3. Clear timeout and move to next provider
    //         await redis.del(`request:${requestId}:timeout`);
    //         await processNextProvider(requestId, userId);

    //     }, 20000);
    // };

    // Set up timeout handler for request that has no responses
    const setupRequestTimeout = (requestId: string, userId: string) => {
        setTimeout(async () => {
            try {
                // Check if request is still active
                const status = await redis.hget(`request:${requestId}`, 'status');

                if (status && status === ServiceStatus.SEARCHING) {
                    // No provider accepted the request within timeout
                    await handleNoProvidersAvailable(requestId, userId);
                }
            } catch (error) {
                console.error("Error in request timeout handler:", error);
            }
        }, 30000); // 30 seconds timeout
    };

    const handleNoProvidersAvailable = async (requestId: string, userId: string) => {
        const attempts = await redis.hget(`request:${requestId}`, 'attempts');

        await Promise.all([
            // redis.hset(`request:${requestId}`, 'status', ServiceStatus.NO_PROVIDER),
            redis.multi()
                .del(`request:${requestId}`)
                .del(`request:${requestId}:provider_queue`)
                .exec(),
            ServiceRequest.findByIdAndUpdate(requestId, {
                status: ServiceStatus.NO_PROVIDER,
                searchAttempts: attempts
            })
        ]);
        await notificationService().notifyRequester(userId, 'NO_PROVIDER', requestId);
    };

    // const handleProviderResponse = async (requestId: string, providerId: string, accepted: boolean, userId: string) => {
    //     const currentProvider = await redis.hget(`request:${requestId}`, 'currentProvider');

    //     if (currentProvider !== providerId) {
    //         throw createAppError('Not authorized to respond');
    //     }

    //     if (accepted) {
    //         await handleAcceptance(requestId, providerId, userId);
    //         return { success: true, status: 'ACCEPTED' };
    //     } else {
    //         await handleRejection(requestId, userId);
    //         return { success: true, status: 'REJECTED' };
    //     }
    // };

    const handleProviderResponse = async (requestId: string, providerId: string, accepted: boolean, userId: string) => {
        try {
            // Check if request is still active and this provider is eligible
            const [status, isActiveProvider] = await Promise.all([
                redis.hget(`request:${requestId}`, 'status'),
                redis.sismember(`request:${requestId}:active_providers`, providerId)
            ]);

            // Verify the request is still in SEARCHING state
            if (status !== ServiceStatus.SEARCHING) {
                return {
                    success: false,
                    status: 'REQUEST_ALREADY_HANDLED',
                    message: 'This request has already been handled'
                };
            }

            // Verify this provider is eligible to respond
            if (!isActiveProvider) {
                return {
                    success: false,
                    status: 'NOT_AUTHORIZED',
                    message: 'Not authorized to respond to this request'
                };
            }

            if (accepted) {
                // Provider accepted the request - handle race conditions with transactions
                return await handleAcceptanceWithPriority(requestId, providerId, userId);
            } else {
                // Provider rejected - remove from active providers
                await redis.srem(`request:${requestId}:active_providers`, providerId);

                // Check if any providers remain active
                const remainingProviders = await redis.scard(`request:${requestId}:active_providers`);

                if (remainingProviders === 0) {
                    // No more active providers, handle no providers case
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

    // Handle race conditions when multiple providers accept the same request
    const handleAcceptanceWithPriority = async (requestId: string, providerId: string, userId: string) => {
        try {
            // Start a Redis transaction to handle race conditions
            const result = await redis.multi()
                // Check if status is still SEARCHING
                .hget(`request:${requestId}`, 'status')
                // Try to mark request as being processed by this provider
                .set(`request:${requestId}:processing`, providerId)
                .exec();

            // Check if result is null (in case of Redis connection issues)
            if (!result) {
                throw createAppError("Redis transaction failed");
            }

            const status = result[0][1] as string | null;
            const lockAcquired = result[1][1] === 'OK';
            // Another provider already got the request or it's no longer available
            if (status !== ServiceStatus.SEARCHING || !lockAcquired) {
                return {
                    success: false,
                    status: 'REQUEST_ALREADY_ACCEPTED',
                    message: 'This request has already been accepted by another provider'
                };
            }

            // Get all available providers to find this provider's distance
            const availableProvidersStr = await redis.get(`request:${requestId}:available_providers`);

            if (!availableProvidersStr) {
                // Something went wrong, clean up and return error
                await redis.del(`request:${requestId}:processing`);
                return {
                    success: false,
                    status: 'PROVIDERS_NOT_FOUND',
                    message: 'Provider data not found'
                };
            }

            const availableProviders = JSON.parse(availableProvidersStr) as ProviderWithDistance[];
            const thisProvider = availableProviders.find(p => p.providerId === providerId);

            if (!thisProvider) {
                // Provider not found in available providers
                await redis.del(`request:${requestId}:processing`);
                return {
                    success: false,
                    status: 'PROVIDER_NOT_ELIGIBLE',
                    message: 'Provider not eligible for this request'
                };
            }

            // Get this provider's location for the request record
            const coordinates = await getProviderLocationFromGeo(providerId);

            // Generate OTP for verification
            const otp = generateOTP();
            const expiresAt = getExpiryTime();

            // Create OTP record
            const requestOTP = new RequestOTP({
                serviceRequest: requestId,
                provider: providerId,
                requester: userId,
                otp,
                expiresAt
            });

            await requestOTP.save();

            // Get all providers who accepted for analytics
            const acceptedProviders = await redis.get(`request:${requestId}:accepted_providers`);
            let acceptedProvidersList = acceptedProviders ? JSON.parse(acceptedProviders) : [];
            acceptedProvidersList.push({
                providerId,
                distance: thisProvider.distance,
                timestamp: Date.now()
            });

            // Update request status and clean up Redis
            await Promise.all([
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
                        acceptedProviders: acceptedProvidersList
                    }
                ),

                // Clean up Redis keys
                redis.multi()
                    .hset(`request:${requestId}`, {
                        status: ServiceStatus.ACCEPTED,
                        currentProvider: providerId
                    })
                    .del(`request:${requestId}:timeout`)
                    .del(`request:${requestId}:active_providers`)
                    .set(`request:${requestId}:accepted_providers`, JSON.stringify(acceptedProvidersList))
                    .expire(`request:${requestId}`, 3600) // Keep for 1 hour for reference
                    .exec(),

                // Notify requester that request was accepted
                notificationService().notifyRequester(userId, 'ACCEPTED', requestId),

                // Notify provider that they got the request
                notificationService().notifyProvider(providerId, 'request:accepted', requestId)
            ]);

            // Notify all other active providers that the request is no longer available
            await notifyOtherProvidersOfAcceptance(requestId, providerId);

            return {
                success: true,
                status: 'ACCEPTED',
                message: 'Request accepted successfully'
            };
        } catch (error) {
            console.error("Error handling acceptance with priority:", error);
            // Clean up lock in case of error
            await redis.del(`request:${requestId}:processing`);
            throw createAppError("Failed to process request acceptance");
        }
    };

    // Notify other providers that the request has been accepted
    const notifyOtherProvidersOfAcceptance = async (requestId: string, acceptedProviderId: string) => {
        try {
            // Get available providers from Redis
            const availableProvidersStr = await redis.get(`request:${requestId}:available_providers`);

            if (!availableProvidersStr) return;

            const availableProviders = JSON.parse(availableProvidersStr) as ProviderWithDistance[];

            // Notify all providers except the one who got the request
            const notificationPromises = availableProviders
                .filter(p => p.providerId !== acceptedProviderId)
                .map(provider =>
                    notificationService().notifyProvider(
                        provider.providerId,
                        'request:unavailable',
                        {
                            requestId,
                            message: 'This request is no longer available'
                        }
                    )
                );

            await Promise.all(notificationPromises);
        } catch (error) {
            console.error("Error notifying other providers:", error);
            // Non-critical operation, don't throw
        }
    };

    // const handleAcceptance = async (requestId: string, providerId: string, userId: string) => {

    //     const [userDetails, attempts] = await Promise.all([
    //         User.findById(userId).select("firstName lastName phoneNo email -_id"),
    //         redis.hget(`request:${requestId}`, 'attempts')
    //     ]);

    //     const coordinates = await getProviderLocationFromGeo(providerId);
    //     const otp = generateOTP();
    //     const expiresAt = getExpiryTime();

    //     const requestOTP = new RequestOTP({
    //         serviceRequest: requestId,
    //         provider: providerId,
    //         requester: userId,
    //         otp,
    //         expiresAt
    //     });

    //     await requestOTP.save();

    //     await Promise.all([
    //         // Update service request
    //         ServiceRequest.findByIdAndUpdate(
    //             requestId,
    //             {
    //                 status: ServiceStatus.ACCEPTED,
    //                 provider: providerId,
    //                 searchAttempts: attempts,
    //                 prvLocation: {
    //                     type: 'Point',
    //                     coordinates: [coordinates?.longitude, coordinates?.latitude]
    //                 },
    //                 otpGenerated: true
    //             }
    //         ),

    //         // Clean up Redis
    //         redis.multi()
    //             .del(`request:${requestId}`)
    //             .del(`request:${requestId}:timeout`)
    //             .del(`request:${requestId}:provider_queue`)
    //             .exec(),

    //         // Send Notifications
    //         Promise.all([
    //             notificationService().notifyProvider(providerId, 'request:accepted', requestId),
    //             notificationService().notifyRequester(userId, 'ACCEPTED', requestId)
    //         ])
    //     ]).catch(error => {

    //         console.error('Error in parallel operations:', error);
    //         throw createAppError('Error in parallel operation of request acceptance')
    //     });
    // };

    // const handleRejection = async (requestId: string, userId: string) => {
    //     await redis.del(`request:${requestId}:timeout`);
    //     const nextAvailable = await processNextProvider(requestId, userId);
    //     if (!nextAvailable) {
    //         await handleNoProvidersAvailable(requestId, userId);
    //     }
    // };

    // const getProviderDetails = async (providerId: string) => {
    //     const [providerDetails, otpDetails] = await Promise.all([
    //         Provider.findById(providerId)
    //             .select('-_id -userId -__v -rating -completedServices -cancelledServices -baseLocation -status -services')
    //             .populate<{ userId: IUser}>({
    //                 path: 'userId',
    //                 select: 'firstName lastName phoneNo email -_id'
    //             })
    //             .lean(),
    //         RequestOTP.findOne({
    //             provider: providerId,
    //             verified: false,
    //             expiresAt: { $gt: new Date() }
    //         })
    //         .select<IRequestOTP>('otp')
    //         .lean()
    //     ]);

    //     if (!providerDetails) {
    //         throw createAppError("Provider Not found");
    //     }
    //     return {
    //         firstName: providerDetails.userId.firstName,
    //         lastName: providerDetails.userId.lastName,
    //         phoneNo: providerDetails.userId.phoneNo,
    //         email: providerDetails.userId.email,
    //         otp: otpDetails?.otp
    //     }
    // }

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

    return {
        createNewServiceRequest,
        startProviderSearch,
        handleProviderResponse,
        // processNextProvider,
        findNearbyProviders,
        getServiceRequestDetails,
        getRequesterDetails,
        setupRequestTimeout
    }
}

export default requestService;