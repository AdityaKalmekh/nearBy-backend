import { Server as HTTPServer } from "http";
import { Server } from 'socket.io';

// Store socket mappings in closure
const userSockets = new Map<string, string>();
const providerSockets = new Map<string, string>();
const serviceRequestRooms = new Map<string, Set<string>>();

export function createSocketServer(httpServer: HTTPServer) {
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

    function setupSocketConnections() {
        io.on('connection', (socket) => {

            socket.on('auth:user', (userId: string) => {
                userSockets.set(userId, socket.id);
                socket.join(`user:${userId}`);
            });

            socket.on('auth:provider', (providerId: string) => {
                providerSockets.set(providerId, socket.id);
                socket.join(`provider:${providerId}`);
            });

            // Service request room handlers
            socket.on('join:service_request', ({ serviceRequestId, userId, userType }: {
                serviceRequestId: string;
                userId: string;
                userType: 'provider' | 'requester';
            }) => {
                const roomName = `service_request:${serviceRequestId}`;
                const rooms = Array.from(socket.rooms);
                if (!rooms.includes(roomName)) {
                    socket.join(roomName);
    
                    // Track room members
                    if (!serviceRequestRooms.has(roomName)) {
                        serviceRequestRooms.set(roomName, new Set());
                    }
                    serviceRequestRooms.get(roomName)?.add(userId);
    
                    console.log(`${userId} ${userType} joined room`);
                    // Notify room members
                    socket.to(roomName).emit('room:joined', {
                        userId,
                        userType
                    });
                }
            });

            // Location update handler
            socket.on('location:update', ({ serviceRequestId, location }: {
                serviceRequestId: string;
                location: { coordinates: [number, number] };
            }) => {
                const roomName = `service_request:${serviceRequestId}`;
                socket.to(roomName).emit('location:updated', location);
            });
            
                    socket.on('disconnect', () => {
                        // Clean up maps
                        for (const [userId, socketId] of userSockets.entries()) {
                            // if (socketId === socket.id) userSockets.delete(userId);
                    if (socketId === socket.id) {
                        userSockets.delete(userId);
                        // Leave all service request rooms
                        serviceRequestRooms.forEach((members, roomName) => {
                            if (members.has(userId)) {
                                members.delete(userId);
                                if (members.size === 0) {
                                    serviceRequestRooms.delete(roomName);
                                }
                            }
                        });
                    }
                }
                for (const [providerId, socketId] of providerSockets.entries()) {
                    if (socketId === socket.id) providerSockets.delete(providerId);
                }
            });

            socket.on('error', (error) => {
                console.error('Socket error:', error);
            });
        });
    }

    setupSocketConnections();

    return {
        emitToProvider: (providerId: string, event: string, data: any) => {
            io.to(`provider:${providerId}`).emit(event, data);
        },
        emitToUser: (userId: string, event: string, data: any) => {
            io.to(`user:${userId}`).emit(event, data);
        },
        emitToServiceRequest: (serviceRequestId: string, event: string, data:any) => {
            io.to(`service_request:${serviceRequestId}`).emit(event, data);
        },
        isProviderOnline: (providerId: string) => providerSockets.has(providerId),
        getRoomMembers: (serviceRequestId: string) => 
            serviceRequestRooms.get(`service_request:${serviceRequestId}`) || new Set()
    };
}