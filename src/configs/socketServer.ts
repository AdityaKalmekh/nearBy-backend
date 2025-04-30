import { Server as HTTPServer } from "http";
import { Server, Socket } from 'socket.io';
import { isSignificantMovement } from "../utils/significantMovement.utils";
import { getRedisClient } from "./redis";

// Types for better type safety
interface SocketUser {
    userId: string;
    socketId: string;
    joinedAt: number;
}

interface SocketRoom {
    roomId: string;
    members: Set<string>;
    createdAt: number;
}

export function createSocketServer(httpServer: HTTPServer) {
    // Store socket mappings with additional metadata
    const userSockets = new Map<string, SocketUser>();
    const providerSockets = new Map<string, SocketUser>();
    const serviceRequestRooms = new Map<string, SocketRoom>();

    const io = new Server(httpServer, {
        cors: {
            origin: `${process.env.CORS_ORIGIN}` || 'https://nearby-frontend-psi.vercel.app',
            credentials: true,
            methods: ["GET", "POST"],
            allowedHeaders: ["Content-Type", "Authorization"]
        },
        path: '/socket.io/',
        transports: ['polling', 'websocket'],
        allowEIO3: true,
        pingTimeout: 60000,
        pingInterval: 25000,
        connectTimeout: 45000,
        maxHttpBufferSize: 1e8
    });

    // Track connection status for monitoring
    const connectionStats = {
        totalConnections: 0,
        activeConnections: 0,
        userConnections: 0,
        providerConnections: 0,
    };

    function setupSocketConnections() {
        io.on('connection', (socket: Socket) => {
            // Update connection stats
            connectionStats.totalConnections++;
            connectionStats.activeConnections++;

            // Log connection for debugging
            console.log(`[Socket] New connection: ${socket.id}`);

            // Set up event handlers for this socket
            setupAuthHandlers(socket);
            setupRoomHandlers(socket);
            setupLocationHandlers(socket);
            setupMessageHandlers(socket);
            setupDisconnectHandlers(socket);
            setupErrorHandlers(socket);
        });
    }

    /**
 * Set up authentication handlers for users and providers
 */
    function setupAuthHandlers(socket: Socket) {
        // User authentication
        socket.on('auth:user', (userId: string) => {
            if (!userId) return;

            userSockets.set(userId, {
                userId,
                socketId: socket.id,
                joinedAt: Date.now()
            });

            socket.join(`user:${userId}`);
            connectionStats.userConnections++;

            console.log(`[Socket] User authenticated: ${userId}, count:${connectionStats.userConnections} `);
        });

        // Provider authentication
        socket.on('auth:provider', (providerId: string) => {
            if (!providerId) return;

            providerSockets.set(providerId, {
                userId: providerId,
                socketId: socket.id,
                joinedAt: Date.now()
            });

            socket.join(`provider:${providerId}`);
            connectionStats.providerConnections++;

            console.log(`[Socket] Provider authenticated: ${providerId}, count:${connectionStats.providerConnections}`);
        });
    }

    /**
    * Set up service request room handlers
    */
    function setupRoomHandlers(socket: Socket) {
        // Join service request room
        socket.on('join:service_request', ({
            serviceRequestId,
            userId,
            userType
        }: {
            serviceRequestId: string;
            userId: string;
            userType: 'provider' | 'requester';
        }) => {
            if (!serviceRequestId || !userId || !userType) return;

            const roomName = `service_request:${serviceRequestId}`;

            // Join room if not already joined
            const rooms = Array.from(socket.rooms);
            if (!rooms.includes(roomName)) {
                socket.join(roomName);

                // Track room members
                if (!serviceRequestRooms.has(roomName)) {
                    serviceRequestRooms.set(roomName, {
                        roomId: roomName,
                        members: new Set<string>(),
                        createdAt: Date.now()
                    });
                }

                // Add user to room members
                const room = serviceRequestRooms.get(roomName);
                if (room) {
                    room.members.add(userId);
                }

                console.log(`[Socket] ${userId} (${userType}) joined room: ${roomName}`);

                // Notify room members
                socket.to(roomName).emit('room:joined', {
                    userId,
                    userType,
                    timestamp: Date.now()
                });
            }
        });

        // Leave service request room
        socket.on('leave:service_request', ({
            serviceRequestId,
            userId
        }: {
            serviceRequestId: string;
            userId: string;
        }) => {
            if (!serviceRequestId || !userId) return;

            const roomName = `service_request:${serviceRequestId}`;
            socket.leave(roomName);

            // Update room members
            const room = serviceRequestRooms.get(roomName);
            if (room) {
                room.members.delete(userId);

                // Clean up empty rooms
                if (room.members.size === 0) {
                    serviceRequestRooms.delete(roomName);
                }
            }

            console.log(`[Socket] ${userId} left room: ${roomName}`);

            // Notify room members
            socket.to(roomName).emit('room:left', {
                userId,
                timestamp: Date.now()
            });
        });
    }


    /**
     * Set up location update handlers
     */
    function setupLocationHandlers(socket: Socket) {
        // Location update handler
        socket.on('location:update', ({
            serviceRequestId,
            location
        }: {
            serviceRequestId: string;
            location: { coordinates: [number, number] };
        }) => {
            if (!serviceRequestId || !location) return;

            const roomName = `service_request:${serviceRequestId}`;

            // Broadcast location update to room members
            socket.to(roomName).emit('location:updated', {
                location,
                timestamp: Date.now()
            });
        });

        socket.on('provider:location', async ({
            providerId,
            location,
            source = 'app',
            accuracy = 0
        }: {
            providerId: string;
            location: { coordinates: [number, number] }; // [longitude, latitude]
            source?: string;
            accuracy?: number;
        }) => {
            console.log("provider:location event triggred");
            console.log("ProviderId = ", providerId);
            console.log("Location = ", location);
            console.log("Source = ", source);
            console.log("Accuracy = ", accuracy);
            

            if (!providerId || !location) return;

            try {
                const redis = getRedisClient();
                if (!redis) return;

                // Check if provider is active
                const isActive = await redis.sismember('active:providers', providerId);
                console.log(`IsActive value ----------->`, isActive);
                
                if (!isActive) {
                    // Provider not active - ignore location update
                    return;
                }

                // Get current coordinates to check if update is needed
                const currentCoords = await redis.geopos('provider:locations', providerId);

                // Only update if no previous position or significant movement
                if (!currentCoords || !currentCoords[0]) {
                    // No previous position, update
                    await updateProviderLocation(providerId, location, source, accuracy);
                    console.log(`Added new data to redis`);
                } else {
                    const [longitude, latitude] = currentCoords[0];

                    // Check if movement is significant (more than 50 meters)
                    const isSignificant = isSignificantMovement({
                        oldLat: parseFloat(latitude),
                        oldLng: parseFloat(longitude),
                        newLat: location.coordinates[1],
                        newLng: location.coordinates[0]
                    });

                    console.log(`Significant movement detection ------->`, isSignificant);
                    
                    if (isSignificant) {
                        // Update provider location
                        await updateProviderLocation(providerId, location, source, accuracy);
                    }
                }
            } catch (error) {
                console.error(`[Socket] Error updating provider location for ${providerId}:`, error);
            }
        });
    }

    /**
     * Set up messaging handlers
     */
    function setupMessageHandlers(socket: Socket) {
        // Send message to service request room
        socket.on('message:send', ({
            serviceRequestId,
            userId,
            userType,
            message
        }: {
            serviceRequestId: string;
            userId: string;
            userType: 'provider' | 'requester';
            message: string;
        }) => {
            if (!serviceRequestId || !userId || !message) return;

            const roomName = `service_request:${serviceRequestId}`;

            // Broadcast message to room members
            io.to(roomName).emit('message:received', {
                userId,
                userType,
                message,
                timestamp: Date.now()
            });
        });
    }

    /**
    * Set up disconnect handlers
    */
    function setupDisconnectHandlers(socket: Socket) {
        socket.on('disconnect', () => {
            // Update connection stats
            connectionStats.activeConnections--;

            // Clean up user mappings
            for (const [userId, user] of userSockets.entries()) {
                if (user.socketId === socket.id) {
                    userSockets.delete(userId);
                    connectionStats.userConnections--;

                    // Leave all service request rooms
                    cleanupUserFromRooms(userId);
                    break;
                }
            }

            // Clean up provider mappings
            for (const [providerId, provider] of providerSockets.entries()) {
                if (provider.socketId === socket.id) {
                    providerSockets.delete(providerId);
                    connectionStats.providerConnections--;

                    // Leave all service request rooms
                    cleanupUserFromRooms(providerId);
                    break;
                }
            }

            console.log(`[Socket] Disconnected: ${socket.id}`);
        });
    }

    /**
    * Remove user from all rooms they were part of
    */
    function cleanupUserFromRooms(userId: string) {
        serviceRequestRooms.forEach((room, roomName) => {
            if (room.members.has(userId)) {
                room.members.delete(userId);

                // Clean up empty rooms
                if (room.members.size === 0) {
                    serviceRequestRooms.delete(roomName);
                } else {
                    // Notify room members of disconnection
                    io.to(roomName).emit('room:left', {
                        userId,
                        reason: 'disconnected',
                        timestamp: Date.now()
                    });
                }
            }
        });
    }

    /**
     * Set up error handlers
     */
    function setupErrorHandlers(socket: Socket) {
        socket.on('error', (error) => {
            console.error(`[Socket] Error for ${socket.id}:`, error);
        });
    }

    setupSocketConnections();

    return {
        /**
        * Emit an event to a specific provider
        */
        emitToProvider: (providerId: string, event: string, data: any) => {
            io.to(`provider:${providerId}`).emit(event, data);
        },

        /**
         * Emit an event to a specific user
         */
        emitToUser: (userId: string, event: string, data: any) => {
            io.to(`user:${userId}`).emit(event, data);
        },
        /**
       * Emit an event to all members of a service request room
       */
        emitToServiceRequest: (serviceRequestId: string, event: string, data: any) => {
            io.to(`service_request:${serviceRequestId}`).emit(event, data);
        },
        /**
         * Check if a provider is currently online
         */
        isProviderOnline: (providerId: string) => providerSockets.has(providerId),

        /**
         * Check if a user is currently online
         */
        isUserOnline: (userId: string) => userSockets.has(userId),

        /**
         * Get all members of a service request room
         */
        getRoomMembers: (serviceRequestId: string) => {
            const room = serviceRequestRooms.get(`service_request:${serviceRequestId}`);
            return room ? Array.from(room.members) : [];
        },

        /**
         * Get connection statistics
         */
        getConnectionStats: () => ({ ...connectionStats })
    };
}

async function updateProviderLocation(
    providerId: string,
    location: { coordinates: [number, number]; },
    source: string,
    accuracy: number
) {
    console.log(`Update provide loation is called`);
    
    const redis = getRedisClient();
    if (!redis) return false;

    try {
        // Use pipeline for better performance
        const pipeline = redis.pipeline();

        // Update geo index
        pipeline.geoadd(
            'provider:locations',
            location.coordinates[0],  // longitude
            location.coordinates[1],  // latitude
            providerId
        );

        // Update metadata
        pipeline.set(
            `provider:${providerId}:metadata`,
            JSON.stringify({
                lastUpdate: Date.now(),
                source,
                accuracy
            })
        );

        // Refresh TTL
        pipeline.expire(`provider:${providerId}:metadata`, 7200);

        // Execute pipeline
        const results = await pipeline.exec();

        return results && !results.some(([err]) => err);
    } catch (error) {
        console.error(`Error updating provider location in Redis for ${providerId}:`, error);
        return false;
    }
}
