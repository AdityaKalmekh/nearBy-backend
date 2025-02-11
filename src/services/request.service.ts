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

            const redisRequestData = {
                currentProvider: requestData.currentProvider,
                attempts: requestData.attempts,
                status: requestData.status
            }

            await redis.multi()
                .hset(`request:${requestId}`, redisRequestData)
                .expire(`request:${requestId}`, 3600)
                .exec();

            return requestData;
        } catch (error) {
            throw error;
        }
    }

    const startProviderSearch = async (requestData: RequestData) => {
        const location = {
            longitude: requestData.longitude,
            latitude: requestData.latitude
        }
        const providers = await findNearbyProviders(location);
        const providerQueue = providers?.map(p => ({
            providerId: p.providerId,
            distance: p.distance
        }));

        if (providerQueue) {
            await Promise.all([
                redis.set(
                    `request:${requestData.requestId}:provider_queue`,
                    JSON.stringify(providerQueue),
                    'EX',
                    3600
                ),
                ServiceRequest.findByIdAndUpdate(requestData.requestId, {
                    availableProviders: providerQueue
                })
            ])

            return processNextProvider(requestData.requestId, requestData.userId);
        }
        return false;
    };

    const processNextProvider = async (requestId: string, userId: string) => {
        try {
            // 1. Get provider queue
            const queueStr = await redis.get(`request:${requestId}:provider_queue`);
            if (!queueStr) {
                await handleNoProvidersAvailable(requestId);
                return false;
            }
            const queue = JSON.parse(queueStr) as ProviderWithDistance[];

            // 2. Get next provider
            const nextProvider = queue.shift();

            if (!nextProvider) {
                await handleNoProvidersAvailable(requestId);
                return false;
            }

            await redis.multi()
                .set(`request:${requestId}:provider_queue`, JSON.stringify(queue))
                .hset(`request:${requestId}`, {
                    'currentProvider': nextProvider.providerId
                })
                .hincrby(`request:${requestId}`, 'attempts', 1)
                .set(`request:${requestId}:timeout`, 'true', 'EX', 22)
                .exec();

            const requestData = {
                userId,
                distance: nextProvider.distance,
                requestId
            }

            await notificationService().notifyProvider(nextProvider.providerId, 'new:request', requestData);
            setupTimeout(nextProvider.providerId, requestId, userId);
            return true;
        } catch (error) {
            throw createAppError("Failed to process next provider");
        }
    };

    const setupTimeout = (providerId: string, requestId: string, userId: string) => {
        setTimeout(async () => {
            // 1. Check if timeout is still valid
            const timeoutExists = await redis.get(`request:${requestId}:timeout`);
            if (!timeoutExists) {
                return; // Request was already handled
            }

            // 2. Verify current provider
            const currentProvider = await redis.hget(`request:${requestId}`, 'currentProvider');
            if (currentProvider !== providerId) {
                return; // Another provider is handling
            }

            // 3. Clear timeout and move to next provider
            await redis.del(`request:${requestId}:timeout`);
            await processNextProvider(requestId, userId);

        }, 20000);
    };

    const handleNoProvidersAvailable = async (requestId: string) => {
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
        ])
        await notificationService().notifyRequester(requestId, 'NO_PROVIDER');
    };

    const handleProviderResponse = async (requestId: string, providerId: string, accepted: boolean, userId: string) => {
        const currentProvider = await redis.hget(`request:${requestId}`, 'currentProvider');

        if (currentProvider !== providerId) {
            throw createAppError('Not authorized to respond');
        }

        if (accepted) {
            await handleAcceptance(requestId, providerId, userId);
            return { success: true, status: 'ACCEPTED' };
        } else {
            await handleRejection(requestId, userId);
            return { success: true, status: 'REJECTED' };
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
            throw error;
        }
    }

    const handleAcceptance = async (requestId: string, providerId: string, userId: string) => {

        const [userDetails, attempts] = await Promise.all([
            User.findById(userId).select("firstName lastName phoneNo email -_id"),
            redis.hget(`request:${requestId}`, 'attempts')
        ]);

        const coordinates = await getProviderLocationFromGeo(providerId);
        const otp = generateOTP();
        const expiresAt = getExpiryTime();

        const requestOTP = new RequestOTP({
            serviceRequest: requestId,
            provider: providerId,
            requester: userId,
            otp,
            expiresAt
        });

        await requestOTP.save();

        await Promise.all([
            // Update service request
            ServiceRequest.findByIdAndUpdate(
                requestId,
                {
                    status: ServiceStatus.ACCEPTED,
                    provider: providerId,
                    searchAttempts: attempts,
                    prvLocation: {
                        type: 'Point',
                        coordinates: [coordinates?.longitude, coordinates?.latitude]
                    },
                    otpGenerated: true
                }
            ),

            // Clean up Redis
            redis.multi()
                .del(`request:${requestId}`)
                .del(`request:${requestId}:timeout`)
                .del(`request:${requestId}:provider_queue`)
                .exec(),

            // Send Notifications
            Promise.all([
                // notificationService().notifyProvider(providerId, 'request:accepted', {
                //     firstName: userDetails?.firstName,
                //     lastName: userDetails?.lastName,
                //     phoneNo: userDetails?.phoneNo,
                //     email: userDetails?.email
                // }),
                notificationService().notifyProvider(providerId, 'request:accepted', requestId),
                notificationService().notifyRequester(userId, 'ACCEPTED', requestId)
            ])
        ]).catch(error => {

            console.error('Error in parallel operations:', error);
            throw createAppError('Error in parallel operation of request acceptance')
        });
    };

    const handleRejection = async (requestId: string, userId: string) => {
        await redis.del(`request:${requestId}:timeout`);
        const nextAvailable = await processNextProvider(requestId, userId);
        if (!nextAvailable) {
            await handleNoProvidersAvailable(requestId);
        }
    };

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
        processNextProvider,
        findNearbyProviders,
        getServiceRequestDetails,
        getRequesterDetails
    }
}

export default requestService;