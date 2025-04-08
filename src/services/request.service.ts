import { getRedisClient } from "../configs/redis";
import { createAppError } from "../errors/errors";
import { ProviderWithDistance, RequestData } from "../types/request.types";
import { notificationService } from "./notification.service";
import { ServiceRequest } from "../models/ServiceRequest";
import { ServiceStatus, ProviderAcceptance, RequesterLocation } from "../types/servicerequest.types";
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
    // const setupRequestTimeout = (requestId: string, userId: string) => {
    //     setTimeout(async () => {
    //         try {
    //             // Check if request is still active
    //             const status = await redis.hget(`request:${requestId}`, 'status');

    //             if (status && status === ServiceStatus.SEARCHING) {
    //                 // No provider accepted the request within timeout
    //                 await handleNoProvidersAvailable(requestId, userId);
    //             }
    //         } catch (error) {
    //             console.error("Error in request timeout handler:", error);
    //         }
    //     }, 30000); // 30 seconds timeout
    // };

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

    // const handleNoProvidersAvailable = async (requestId: string, userId: string) => {
    //     const attempts = await redis.hget(`request:${requestId}`, 'attempts');

    //     await Promise.all([
    //         // redis.hset(`request:${requestId}`, 'status', ServiceStatus.NO_PROVIDER),
    //         redis.multi()
    //             .del(`request:${requestId}`)
    //             .del(`request:${requestId}:available_providers`)
    //             .del(`request:${requestId}:active_providers`)
    //             .del(`request:${requestId}:timeout`)
    //             .exec(),

    //         ServiceRequest.findByIdAndUpdate(requestId, {
    //             status: ServiceStatus.NO_PROVIDER,
    //             searchAttempts: attempts
    //         })
    //     ]);
    //     await notificationService().notifyRequester(userId, 'NO_PROVIDER', requestId);
    //     return true;
    // };

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

    // const handleProviderResponse = async (requestId: string, providerId: string, accepted: boolean, userId: string) => {
    //     try {
    //         // Check if request is still active and this provider is eligible
    //         const [status, isActiveProvider] = await Promise.all([
    //             redis.hget(`request:${requestId}`, 'status'),
    //             redis.sismember(`request:${requestId}:active_providers`, providerId)
    //         ]);

    //         // Verify the request is still in SEARCHING state
    //         if (status !== ServiceStatus.SEARCHING) {
    //             return {
    //                 success: false,
    //                 status: 'REQUEST_ALREADY_HANDLED',
    //                 message: 'This request has already been handled'
    //             };
    //         }

    //         // Verify this provider is eligible to respond
    //         if (!isActiveProvider) {
    //             return {
    //                 success: false,
    //                 status: 'NOT_AUTHORIZED',
    //                 message: 'Not authorized to respond to this request'
    //             };
    //         }

    //         if (accepted) {
    //             // Provider accepted the request - handle race conditions with transactions
    //             return await handleAcceptanceWithPriority(requestId, providerId, userId);
    //         } else {
    //             // Provider rejected - remove from active providers
    //             await redis.srem(`request:${requestId}:active_providers`, providerId);

    //             // Check if any providers remain active
    //             const remainingProviders = await redis.scard(`request:${requestId}:active_providers`);

    //             if (remainingProviders === 0) {
    //                 // No more active providers, handle no providers case
    //                 await handleNoProvidersAvailable(requestId, userId);
    //             }

    //             return {
    //                 success: true,
    //                 status: 'REJECTED',
    //                 message: 'Request rejected successfully'
    //             };
    //         }
    //     } catch (error) {
    //         console.error("Error handling provider response:", error);
    //         throw createAppError("Failed to process provider response");
    //     }
    // };

    // Handle provider response (accept/reject)
    const handleProviderResponse = async (requestId: string, providerId: string, accepted: boolean, userId: string) => {
        try {
            console.log(`Provider ${providerId} responding to request ${requestId}, accepted: ${accepted}`);
            // Check if request is still active and this provider is eligible
            const [status, isActiveProvider] = await Promise.all([
                redis.hget(`request:${requestId}`, 'status'),
                redis.sismember(`request:${requestId}:active_providers`, providerId)
            ]);

            console.log(`Request ${requestId} status: ${status}, Provider is active: ${isActiveProvider}`);
            // Verify the request is in SEARCHING or COLLECTION state
            if (status !== ServiceStatus.SEARCHING && status !== ServiceStatus.COLLECTION) {
                console.log(`Request ${requestId} is in invalid state: ${status}`);
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
                // Provider accepted the request
                console.log(`Provider ${providerId} accepted request ${requestId}, handling acceptance`);
                return await handleAcceptance(requestId, providerId, userId);
            } else {
                // Provider rejected - remove from active providers
                console.log(`Provider ${providerId} rejected request ${requestId}`);
                await redis.srem(`request:${requestId}:active_providers`, providerId);

                // Check if any providers remain active
                const remainingProviders = await redis.scard(`request:${requestId}:active_providers`);
                console.log(`${remainingProviders} providers still active for request ${requestId}`);

                if (remainingProviders === 0) {
                    // No more active providers, handle no providers case
                    console.log(`No remaining providers for request ${requestId}, handling no providers available`);
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
    // const handleProviderResponse = async (requestId: string, providerId: string, accepted: boolean, userId: string) => {
    //     try {
    //         // Step 1: Check current request status atomically with WATCH
    //         await redis.watch(`request:${requestId}`);
    //         const status = await redis.hget(`request:${requestId}`, 'status');

    //         // Step 2: Verify request is still in SEARCHING state
    //         if (status !== ServiceStatus.SEARCHING) {
    //             await redis.unwatch();
    //             console.log(`Request ${requestId} is no longer in SEARCHING state, current state: ${status}`);
    //             return {
    //                 success: false,
    //                 status: 'REQUEST_ALREADY_HANDLED',
    //                 message: 'This request has already been accepted or is no longer available'
    //             };
    //         }

    //         // Step 3: Check if provider is authorized to respond
    //         const isActiveProvider = await redis.sismember(`request:${requestId}:active_providers`, providerId);
    //         if (!isActiveProvider) {
    //             await redis.unwatch();
    //             console.log(`Provider ${providerId} is not authorized to respond to request ${requestId}`);
    //             return {
    //                 success: false,
    //                 status: 'NOT_AUTHORIZED',
    //                 message: 'You are not authorized to respond to this request'
    //             };
    //         }

    //         // If provider is rejecting, handle differently (no need for strong consistency)
    //         if (!accepted) {
    //             await redis.unwatch(); // Release the watch
    //             return await handleRejection(requestId, providerId, userId);
    //         }

    //         // Step 4: Start acceptance transaction
    //         console.log(`Provider ${providerId} attempting to accept request ${requestId}`);

    //         // Get provider's distance for prioritization
    //         const availableProvidersStr = await redis.get(`request:${requestId}:available_providers`);
    //         if (!availableProvidersStr) {
    //             await redis.unwatch();
    //             console.log(`No available providers found for request ${requestId}`);
    //             return {
    //                 success: false,
    //                 status: 'PROVIDERS_NOT_FOUND',
    //                 message: 'Provider data not found'
    //             };
    //         }

    //         const availableProviders = JSON.parse(availableProvidersStr) as ProviderWithDistance[];
    //         const thisProvider = availableProviders.find(p => p.providerId === providerId);

    //         if (!thisProvider) {
    //             await redis.unwatch();
    //             console.log(`Provider ${providerId} not found in available providers list`);
    //             return {
    //                 success: false,
    //                 status: 'PROVIDER_NOT_ELIGIBLE',
    //                 message: 'You are not eligible for this request'
    //             };
    //         }

    //         // Step 5: Optimistic locking with transaction
    //         // If the watched key changes between WATCH and EXEC, the transaction will fail
    //         const tx = redis.multi();
    //         tx.hset(`request:${requestId}`, 'status', ServiceStatus.ACCEPTED);
    //         tx.hset(`request:${requestId}`, 'currentProvider', providerId);
    //         const txResult = await tx.exec();

    //         // Check if transaction succeeded
    //         if (!txResult || txResult.length === 0) {
    //             console.log(`Transaction failed for request ${requestId}, another provider likely accepted it first`);
    //             return {
    //                 success: false,
    //                 status: 'REQUEST_ALREADY_ACCEPTED',
    //                 message: 'This request was accepted by another provider'
    //             };
    //         }

    //         // Step 6: Transaction succeeded, this provider got the request
    //         console.log(`Provider ${providerId} successfully accepted request ${requestId}`);

    //         // Complete the acceptance process
    //         await completeRequestAcceptance(requestId, providerId, userId, thisProvider.distance);

    //         // Step 7: Notify others and return success
    //         // It's critical to notify other providers BEFORE responding to the current provider
    //         await notifyOtherProvidersOfUnavailability(requestId, providerId);

    //         return {
    //             success: true,
    //             status: 'ACCEPTED',
    //             message: 'Request accepted successfully'
    //         };
    //     } catch (error) {
    //         // Release the watch if there's an error
    //         await redis.unwatch().catch(() => { });
    //         console.error("Error handling provider response:", error);

    //         throw createAppError("Failed to process provider response");
    //     }
    // };

    const handleRejection = async (requestId: string, providerId: string, userId: string) => {
        try {
            // Remove this provider from active providers set
            await redis.srem(`request:${requestId}:active_providers`, providerId);

            // Check if any providers remain active
            const remainingProviders = await redis.scard(`request:${requestId}:active_providers`);

            if (remainingProviders === 0) {
                // No more active providers, handle no providers case
                await handleNoProvidersAvailable(requestId, userId);
            }

            console.log(`Provider ${providerId} rejected request ${requestId}, ${remainingProviders} providers still active`);

            return {
                success: true,
                status: 'REJECTED',
                message: 'Request rejected successfully'
            };
        } catch (error) {
            console.error("Error handling rejection:", error);
            throw createAppError("Failed to process rejection");
        }
    };

    // const completeRequestAcceptance = async (
    //     requestId: string,
    //     providerId: string,
    //     userId: string,
    //     distance: number
    // ) => {
    //     try {
    //         // Step 1: Generate OTP for verification
    //         const otp = generateOTP();
    //         const expiresAt = getExpiryTime();

    //         // Step 2: Save OTP record to database
    //         const requestOTP = new RequestOTP({
    //             serviceRequest: requestId,
    //             provider: providerId,
    //             requester: userId,
    //             otp,
    //             expiresAt
    //         });
    //         await requestOTP.save();

    //         // Step 3: Get provider's current location
    //         const coordinates = await getProviderLocationFromGeo(providerId);

    //         // Step 4: Record this acceptance for analytics
    //         const acceptedProviders = await redis.get(`request:${requestId}:accepted_providers`);
    //         let acceptedProvidersList = acceptedProviders ? JSON.parse(acceptedProviders) : [];
    //         acceptedProvidersList.push({
    //             providerId,
    //             distance,
    //             timestamp: Date.now()
    //         });

    //         // Step 5: Update database and Redis in parallel
    //         await Promise.all([
    //             // Update service request in database
    //             ServiceRequest.findByIdAndUpdate(
    //                 requestId,
    //                 {
    //                     status: ServiceStatus.ACCEPTED,
    //                     provider: providerId,
    //                     searchAttempts: await redis.hget(`request:${requestId}`, 'attempts') || 0,
    //                     prvLocation: coordinates ? {
    //                         type: 'Point',
    //                         coordinates: [coordinates.longitude, coordinates.latitude]
    //                     } : undefined,
    //                     otpGenerated: true,
    //                     acceptedProviders: acceptedProvidersList
    //                 }
    //             ),

    //             // Clean up Redis keys and store analytics data
    //             redis.multi()
    //                 .del(`request:${requestId}:timeout`)
    //                 .set(`request:${requestId}:accepted_providers`, JSON.stringify(acceptedProvidersList))
    //                 .expire(`request:${requestId}`, 3600) // Keep for 1 hour for reference
    //                 .exec(),

    //             // Send notifications to users
    //             Promise.all([
    //                 notificationService().notifyRequester(userId, 'ACCEPTED', requestId),
    //                 notificationService().notifyProvider(providerId, 'request:accepted', requestId)
    //             ])
    //         ]);

    //     } catch (error) {
    //         console.error("Error completing request acceptance:", error);
    //         throw error;
    //     }
    // };

    // Handle provider acceptance with a collection window for distance-based prioritization

    // const handleAcceptance = async (requestId: string, providerId: string, userId: string) => {
    //     try {
    //         console.log(`Handling acceptance for request ${requestId} by provider ${providerId}`);

    //         // Get current request status
    //         const status = await redis.hget(`request:${requestId}`, 'status');
    //         console.log(`Current status for request ${requestId}: ${status}`);

    //         // If already in COLLECTION state, just add this provider to the acceptances
    //         if (status === ServiceStatus.COLLECTION) {
    //             console.log(`Request ${requestId} already in COLLECTION state, adding provider ${providerId}`);
    //             await addProviderAcceptance(requestId, providerId);

    //             return {
    //                 success: true,
    //                 status: 'PROCESSING',
    //                 message: 'Your acceptance is being processed'
    //             };
    //         }

    //         // If still in SEARCHING state, transition to COLLECTION state to start gathering acceptances
    //         if (status === ServiceStatus.SEARCHING) {
    //             // Try to transition to COLLECTION state (only first provider will succeed)
    //             console.log(`Attempting to transition request ${requestId} to COLLECTION state`);
    //             const transitioned = await redis.hsetnx(`request:${requestId}`, 'status', ServiceStatus.COLLECTION);

    //             if (transitioned) {
    //                 console.log(`Successfully transitioned request ${requestId} to COLLECTION state`);

    //                 // First provider to accept - add this provider and schedule processing
    //                 await addProviderAcceptance(requestId, providerId);

    //                 // Set a timer to process collected acceptances after the collection window
    //                 // IMPORTANT: Use a direct function call for environments where setTimeout might be unreliable
    //                 // We'll implement both approaches for reliability
    //                 console.log(`Setting up collection window of ${COLLECTION_WINDOW_MS}ms for request ${requestId}`);

    //                 // Method 1: Use setTimeout
    //                 setTimeout(async () => {
    //                     try {
    //                         console.log(`Collection window ended for request ${requestId}, processing acceptances`);
    //                         await processCollectedAcceptances(requestId, userId);
    //                     } catch (err) {
    //                         console.error(`Error in setTimeout callback for request ${requestId}:`, err);
    //                     }
    //                 }, COLLECTION_WINDOW_MS);

    //                 // Method 2: Also set a Redis key with expiry for double safety
    //                 await redis.set(`request:${requestId}:collection_end`, 'true', 'PX', COLLECTION_WINDOW_MS);

    //                 return {
    //                     success: true,
    //                     status: 'PROCESSING',
    //                     message: 'Your acceptance is being processed'
    //                 };
    //             } else {
    //                 // Another provider already transitioned the state
    //                 console.log(`Request ${requestId} was already transitioned to COLLECTION state by another provider`);

    //                 // Just add this provider to the acceptances list
    //                 await addProviderAcceptance(requestId, providerId);

    //                 return {
    //                     success: true,
    //                     status: 'PROCESSING',
    //                     message: 'Your acceptance is being processed'
    //                 };
    //             }
    //         }

    //         // Request is in some other state that doesn't allow acceptance
    //         console.log(`Request ${requestId} is in invalid state for acceptance: ${status}`);
    //         return {
    //             success: false,
    //             status: 'INVALID_STATE',
    //             message: 'This request is no longer available'
    //         };
    //     } catch (error) {
    //         console.error(`Error handling acceptance for request ${requestId}:`, error);
    //         throw createAppError("Failed to process acceptance");
    //     }
    // };

    const handleAcceptance = async (requestId: string, providerId: string, userId: string) => {
        try {
            console.log(`Handling acceptance for request ${requestId} by provider ${providerId}`);

            // IMPORTANT: Use a watch-multi-exec pattern to ensure atomic operations
            // Watch the request status key for changes
            await redis.watch(`request:${requestId}`);

            // Get current request status
            const status = await redis.hget(`request:${requestId}`, 'status');
            console.log(`Current status for request ${requestId}: ${status}`);

            // If already in COLLECTION state, just add this provider to the acceptances
            if (status === ServiceStatus.COLLECTION) {
                // Unwatch since we're not doing a transaction
                await redis.unwatch();

                console.log(`Request ${requestId} is in COLLECTION state, adding provider ${providerId}`);
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
                    console.log(`Transaction failed for request ${requestId}, status likely changed`);
                    await redis.unwatch();

                    // Retry the operation since status likely changed to COLLECTION
                    return await handleAcceptance(requestId, providerId, userId);
                }

                // Transaction succeeded, we are the first to transition
                console.log(`Successfully transitioned request ${requestId} to COLLECTION state`);

                // Add this provider to acceptances
                await addProviderAcceptance(requestId, providerId);

                // Set a timer to process collected acceptances after collection window
                console.log(`Setting up collection window of ${COLLECTION_WINDOW_MS}ms for request ${requestId}`);

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

    // Process all collected acceptances and select the provider with the shortest distance
    // const processCollectedAcceptances = async (requestId: string, userId: string) => {
    //     try {
    //         console.log(`Processing collected acceptances for request ${requestId}`);

    //         // Check if request is still in COLLECTION state
    //         const status = await redis.hget(`request:${requestId}`, 'status');
    //         console.log(`Current status for request ${requestId} when processing acceptances: ${status}`);

    //         if (status !== ServiceStatus.COLLECTION) {
    //             console.log(`Request ${requestId} is no longer in COLLECTION state, skipping processing`);
    //             return false;
    //         }

    //         // Get all collected acceptances
    //         const acceptancesSet = await redis.smembers(`request:${requestId}:acceptances`);
    //         console.log(`Found ${acceptancesSet?.length || 0} acceptances for request ${requestId}`);

    //         if (!acceptancesSet || acceptancesSet.length === 0) {
    //             console.log(`No acceptances collected for request ${requestId}, handling no providers`);
    //             await handleNoProvidersAvailable(requestId, userId);
    //             return false;
    //         }

    //         // Parse the acceptances
    //         const acceptances: ProviderAcceptance[] = [];
    //         for (const acceptanceStr of acceptancesSet) {
    //             try {
    //                 acceptances.push(JSON.parse(acceptanceStr));
    //             } catch (err) {
    //                 console.error(`Error parsing acceptance JSON for request ${requestId}:`, err);
    //                 // Continue with other acceptances
    //             }
    //         }

    //         if (acceptances.length === 0) {
    //             console.log(`No valid acceptances found for request ${requestId}, handling no providers`);
    //             await handleNoProvidersAvailable(requestId, userId);
    //             return false;
    //         }

    //         console.log(`Parsed ${acceptances.length} valid acceptances for request ${requestId}`);

    //         // Find the provider with the shortest distance
    //         let nearestProvider = acceptances[0];
    //         for (const acceptance of acceptances) {
    //             if (acceptance.distance < nearestProvider.distance) {
    //                 nearestProvider = acceptance;
    //             }
    //         }

    //         console.log(`Selected nearest provider ${nearestProvider.providerId} with distance ${nearestProvider.distance} for request ${requestId}`);

    //         // Proceed with accepting this provider
    //         await finalizeProviderAcceptance(requestId, nearestProvider.providerId, userId, acceptances);

    //         return true;
    //     } catch (error) {
    //         console.error(`Error processing collected acceptances for request ${requestId}:`, error);

    //         // If there's an error, try to reset the state to give providers another chance
    //         try {
    //             await redis.hset(`request:${requestId}`, 'status', ServiceStatus.SEARCHING);
    //             console.log(`Reset request ${requestId} to SEARCHING state due to error`);
    //         } catch (err) {
    //             console.error(`Failed to reset state for request ${requestId}:`, err);
    //         }

    //         throw error;
    //     }
    // };

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
                    {
                        requestId,
                        message: 'This request was assigned to another provider who was closer to the pickup location',
                        status: 'UNAVAILABLE'
                    }
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
                            {
                                requestId,
                                message: 'This request has been assigned to another provider',
                                status: 'UNAVAILABLE'
                            }
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

    // const setupCollectionExpiryChecker = () => {
    //     const checkInterval = 1000; // Check every 1 second

    //     setInterval(async () => {
    //         try {
    //             // Get all keys matching the pattern for collection end markers
    //             const keys = await redis.keys(`request:*:collection_end`);

    //             if (keys && keys.length > 0) {
    //                 console.log(`Found ${keys.length} collection windows that may need processing`);

    //                 // Process each expired collection window
    //                 for (const key of keys) {
    //                     try {
    //                         const requestId = key.split(':')[1];
    //                         const status = await redis.hget(`request:${requestId}`, 'status');

    //                         if (status === ServiceStatus.COLLECTION) {
    //                             console.log(`Processing expired collection window for request ${requestId}`);
    //                             const userId = await redis.hget(`request:${requestId}`, 'userId');

    //                             if (userId) {
    //                                 await processCollectedAcceptances(requestId, userId);
    //                             } else {
    //                                 console.error(`No userId found for request ${requestId}`);
    //                             }
    //                         }

    //                         // Delete the key regardless of status to prevent reprocessing
    //                         await redis.del(key);
    //                     } catch (err) {
    //                         console.error(`Error processing collection expiry for key ${key}:`, err);
    //                     }
    //                 }
    //             }
    //         } catch (error) {
    //             console.error("Error checking for expired collection windows:", error);
    //         }
    //     }, checkInterval);
    // };

    // const notifyOtherProvidersOfUnavailability = async (requestId: string, acceptedProviderId: string) => {
    //     try {
    //         // Get all active providers for this request
    //         const activeProviders = await redis.smembers(`request:${requestId}:active_providers`);

    //         // Filter out the accepted provider
    //         const otherProviders = activeProviders.filter(providerId => providerId !== acceptedProviderId);

    //         if (otherProviders.length === 0) {
    //             console.log(`No other providers to notify for request ${requestId}`);
    //             return;
    //         }

    //         console.log(`Notifying ${otherProviders.length} other providers that request ${requestId} is no longer available`);

    //         // Send notifications in parallel
    //         const notifyPromises = otherProviders.map(providerId =>
    //             notificationService().notifyProvider(
    //                 providerId,
    //                 'request:unavailable',
    //                 {
    //                     requestId,
    //                     message: 'This request has been accepted by another provider',
    //                     status: 'UNAVAILABLE'
    //                 }
    //             )
    //         );

    //         await Promise.all(notifyPromises);

    //         // Clean up by removing the active providers set
    //         await redis.del(`request:${requestId}:active_providers`);
    //     } catch (error) {
    //         console.error("Error notifying other providers:", error);
    //         // Non-critical operation, don't throw
    //     }
    // };


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
    // const handleAcceptanceWithPriority = async (requestId: string, providerId: string, userId: string) => {
    //     try {
    //         // Start a Redis transaction to handle race conditions
    //         const result = await redis.multi()
    //             // Check if status is still SEARCHING
    //             .hget(`request:${requestId}`, 'status')
    //             // Try to mark request as being processed by this provider
    //             .set(`request:${requestId}:processing`, providerId)
    //             .exec();

    //         // Check if result is null (in case of Redis connection issues)
    //         if (!result) {
    //             throw createAppError("Redis transaction failed");
    //         }

    //         const status = result[0][1] as string | null;
    //         const lockAcquired = result[1][1] === 'OK';
    //         // Another provider already got the request or it's no longer available
    //         if (status !== ServiceStatus.SEARCHING || !lockAcquired) {
    //             return {
    //                 success: false,
    //                 status: 'REQUEST_ALREADY_ACCEPTED',
    //                 message: 'This request has already been accepted by another provider'
    //             };
    //         }

    //         // Get all available providers to find this provider's distance
    //         const availableProvidersStr = await redis.get(`request:${requestId}:available_providers`);

    //         if (!availableProvidersStr) {
    //             // Something went wrong, clean up and return error
    //             await redis.del(`request:${requestId}:processing`);
    //             return {
    //                 success: false,
    //                 status: 'PROVIDERS_NOT_FOUND',
    //                 message: 'Provider data not found'
    //             };
    //         }

    //         const availableProviders = JSON.parse(availableProvidersStr) as ProviderWithDistance[];
    //         const thisProvider = availableProviders.find(p => p.providerId === providerId);

    //         if (!thisProvider) {
    //             // Provider not found in available providers
    //             await redis.del(`request:${requestId}:processing`);
    //             return {
    //                 success: false,
    //                 status: 'PROVIDER_NOT_ELIGIBLE',
    //                 message: 'Provider not eligible for this request'
    //             };
    //         }

    //         // Get this provider's location for the request record
    //         const coordinates = await getProviderLocationFromGeo(providerId);

    //         // Generate OTP for verification
    //         const otp = generateOTP();
    //         const expiresAt = getExpiryTime();

    //         // Create OTP record
    //         const requestOTP = new RequestOTP({
    //             serviceRequest: requestId,
    //             provider: providerId,
    //             requester: userId,
    //             otp,
    //             expiresAt
    //         });

    //         await requestOTP.save();

    //         // Get all providers who accepted for analytics
    //         const acceptedProviders = await redis.get(`request:${requestId}:accepted_providers`);
    //         let acceptedProvidersList = acceptedProviders ? JSON.parse(acceptedProviders) : [];
    //         acceptedProvidersList.push({
    //             providerId,
    //             distance: thisProvider.distance,
    //             timestamp: Date.now()
    //         });

    //         // Update request status and clean up Redis
    //         await Promise.all([
    //             // Update service request in database
    //             ServiceRequest.findByIdAndUpdate(
    //                 requestId,
    //                 {
    //                     status: ServiceStatus.ACCEPTED,
    //                     provider: providerId,
    //                     searchAttempts: await redis.hget(`request:${requestId}`, 'attempts') || 0,
    //                     prvLocation: coordinates ? {
    //                         type: 'Point',
    //                         coordinates: [coordinates.longitude, coordinates.latitude]
    //                     } : undefined,
    //                     otpGenerated: true,
    //                     acceptedProviders: acceptedProvidersList
    //                 }
    //             ),

    //             // Clean up Redis keys
    //             redis.multi()
    //                 .hset(`request:${requestId}`, {
    //                     status: ServiceStatus.ACCEPTED,
    //                     currentProvider: providerId
    //                 })
    //                 .del(`request:${requestId}:timeout`)
    //                 .del(`request:${requestId}:active_providers`)
    //                 .set(`request:${requestId}:accepted_providers`, JSON.stringify(acceptedProvidersList))
    //                 .expire(`request:${requestId}`, 3600) // Keep for 1 hour for reference
    //                 .exec(),

    //             // Notify requester that request was accepted
    //             notificationService().notifyRequester(userId, 'ACCEPTED', requestId),

    //             // Notify provider that they got the request
    //             notificationService().notifyProvider(providerId, 'request:accepted', requestId)
    //         ]);

    //         // Notify all other active providers that the request is no longer available
    //         await notifyOtherProvidersOfAcceptance(requestId, providerId);

    //         return {
    //             success: true,
    //             status: 'ACCEPTED',
    //             message: 'Request accepted successfully'
    //         };
    //     } catch (error) {
    //         console.error("Error handling acceptance with priority:", error);
    //         // Clean up lock in case of error
    //         await redis.del(`request:${requestId}:processing`);
    //         throw createAppError("Failed to process request acceptance");
    //     }
    // };

    // const handleAcceptanceWithPriority = async (requestId: string, providerId: string, userId: string) => {
    //     try {
    //         // Use Redis WATCH command to create a check-and-set operation
    //         // This will fail the transaction if the key changes between WATCH and EXEC
    //         await redis.watch(`request:${requestId}`);

    //         // Check if request is still in SEARCHING state
    //         const status = await redis.hget(`request:${requestId}`, 'status');

    //         if (status !== ServiceStatus.SEARCHING) {
    //             // Unwatch the key since we're not proceeding with the transaction
    //             await redis.unwatch();
    //             return {
    //                 success: false,
    //                 status: 'REQUEST_ALREADY_ACCEPTED',
    //                 message: 'This request has already been accepted by another provider'
    //             };
    //         }

    //         // Start a multi command (transaction) after watching
    //         const tx = redis.multi();
    //         tx.hset(`request:${requestId}`, 'status', ServiceStatus.ACCEPTED);
    //         tx.hset(`request:${requestId}`, 'currentProvider', providerId);

    //         // Execute the transaction - if the watched key changed, this will return null
    //         const txResult = await tx.exec();

    //         // If transaction failed (null) or was empty, another provider got it first
    //         if (!txResult || txResult.length === 0) {
    //             return {
    //                 success: false,
    //                 status: 'REQUEST_ALREADY_ACCEPTED',
    //                 message: 'This request was accepted by another provider'
    //             };
    //         }

    //         // Get all available providers to find this provider's distance
    //         const availableProvidersStr = await redis.get(`request:${requestId}:available_providers`);

    //         if (!availableProvidersStr) {
    //             // Something went wrong, clean up and return error
    //             await redis.del(`request:${requestId}:processing`);
    //             return {
    //                 success: false,
    //                 status: 'PROVIDERS_NOT_FOUND',
    //                 message: 'Provider data not found'
    //             };
    //         }

    //         const availableProviders = JSON.parse(availableProvidersStr) as ProviderWithDistance[];
    //         const thisProvider = availableProviders.find(p => p.providerId === providerId);

    //         if (!thisProvider) {
    //             // Provider not found in available providers
    //             await redis.del(`request:${requestId}:processing`);
    //             return {
    //                 success: false,
    //                 status: 'PROVIDER_NOT_ELIGIBLE',
    //                 message: 'Provider not eligible for this request'
    //             };
    //         }

    //         // Get this provider's location for the request record
    //         const coordinates = await getProviderLocationFromGeo(providerId);

    //         // Generate OTP for verification
    //         const otp = generateOTP();
    //         const expiresAt = getExpiryTime();

    //         // Create OTP record
    //         const requestOTP = new RequestOTP({
    //             serviceRequest: requestId,
    //             provider: providerId,
    //             requester: userId,
    //             otp,
    //             expiresAt
    //         });

    //         await requestOTP.save();

    //         // Get all providers who accepted for analytics
    //         const acceptedProviders = await redis.get(`request:${requestId}:accepted_providers`);
    //         let acceptedProvidersList = acceptedProviders ? JSON.parse(acceptedProviders) : [];
    //         acceptedProvidersList.push({
    //             providerId,
    //             distance: thisProvider.distance,
    //             timestamp: Date.now()
    //         });

    //         // Update request status and clean up Redis
    //         await Promise.all([
    //             // Update service request in database
    //             ServiceRequest.findByIdAndUpdate(
    //                 requestId,
    //                 {
    //                     status: ServiceStatus.ACCEPTED,
    //                     provider: providerId,
    //                     searchAttempts: await redis.hget(`request:${requestId}`, 'attempts') || 0,
    //                     prvLocation: coordinates ? {
    //                         type: 'Point',
    //                         coordinates: [coordinates.longitude, coordinates.latitude]
    //                     } : undefined,
    //                     otpGenerated: true,
    //                     acceptedProviders: acceptedProvidersList
    //                 }
    //             ),

    //             // Clean up Redis keys
    //             redis.multi()
    //                 .hset(`request:${requestId}`, {
    //                     status: ServiceStatus.ACCEPTED,
    //                     currentProvider: providerId
    //                 })
    //                 .del(`request:${requestId}:timeout`)
    //                 .del(`request:${requestId}:active_providers`)
    //                 .set(`request:${requestId}:accepted_providers`, JSON.stringify(acceptedProvidersList))
    //                 .expire(`request:${requestId}`, 3600) // Keep for 1 hour for reference
    //                 .exec(),

    //             // Notify requester that request was accepted
    //             notificationService().notifyRequester(userId, 'ACCEPTED', requestId),

    //             // Notify provider that they got the request
    //             notificationService().notifyProvider(providerId, 'request:accepted', requestId)
    //         ]);

    //         // Notify all other active providers that the request is no longer available
    //         await notifyOtherProvidersOfAcceptance(requestId, providerId);

    //         return {
    //             success: true,
    //             status: 'ACCEPTED',
    //             message: 'Request accepted successfully'
    //         };
    //     } catch (error) {
    //         console.error("Error handling acceptance with priority:", error);
    //         // Clean up lock in case of error
    //         await redis.del(`request:${requestId}:processing`);
    //         throw createAppError("Failed to process request acceptance");
    //     }
    // };

    // Notify other providers that the request has been accepted
    // const notifyOtherProvidersOfAcceptance = async (requestId: string, acceptedProviderId: string) => {
    //     try {
    //         // Get available providers from Redis
    //         const availableProvidersStr = await redis.get(`request:${requestId}:available_providers`);

    //         if (!availableProvidersStr) return;

    //         const availableProviders = JSON.parse(availableProvidersStr) as ProviderWithDistance[];

    //         // Notify all providers except the one who got the request
    //         const notificationPromises = availableProviders
    //             .filter(p => p.providerId !== acceptedProviderId)
    //             .map(provider =>
    //                 notificationService().notifyProvider(
    //                     provider.providerId,
    //                     'request:unavailable',
    //                     {
    //                         requestId,
    //                         message: 'This request is no longer available'
    //                     }
    //                 )
    //             );

    //         await Promise.all(notificationPromises);
    //     } catch (error) {
    //         console.error("Error notifying other providers:", error);
    //         // Non-critical operation, don't throw
    //     }
    // };

    // const notifyOtherProvidersOfAcceptance = async (requestId: string, acceptedProviderId: string) => {
    //     try {
    //         // First, get the set of active providers directly from Redis
    //         // This is more reliable than using the available_providers list which might be outdated
    //         const activeProviders = await redis.smembers(`request:${requestId}:active_providers`);

    //         if (!activeProviders || activeProviders.length === 0) {
    //             console.log(`No active providers to notify for request ${requestId}`);
    //             return;
    //         }

    //         console.log(`Notifying ${activeProviders.length - 1} other providers that request ${requestId} is no longer available`);

    //         // Create an array of notification promises for all active providers except the accepted one
    //         const notificationPromises = activeProviders
    //             .filter(providerId => providerId !== acceptedProviderId)
    //             .map(providerId =>
    //                 notificationService().notifyProvider(
    //                     providerId,
    //                     'request:unavailable',
    //                     {
    //                         requestId,
    //                         message: 'This request has been accepted by another provider',
    //                         status: 'UNAVAILABLE'
    //                     }
    //                 )
    //             );

    //         // Wait for all notifications to be sent
    //         if (notificationPromises.length > 0) {
    //             await Promise.all(notificationPromises);
    //             console.log(`Successfully notified ${notificationPromises.length} providers that request ${requestId} is unavailable`);
    //         }

    //         // Remove all providers from the active set after notifying them
    //         if (activeProviders.length > 0) {
    //             await redis.del(`request:${requestId}:active_providers`);
    //         }
    //     } catch (error) {
    //         console.error("Error notifying other providers:", error);
    //         // Log error but don't throw - this is a non-critical operation
    //     }
    // };

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

    setupCollectionExpiryChecker();

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