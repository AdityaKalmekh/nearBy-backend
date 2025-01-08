import { Server as HTTPServer } from "http";
import { Server } from 'socket.io';

// Store socket mappings in closure
const userSockets = new Map<string, string>();
const providerSockets = new Map<string, string>();

export function createSocketServer(httpServer: HTTPServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: `${process.env.CORS_ORIGIN}`,
            credentials: true,
            methods: ["GET", "POST", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
        },
        transports: ['websocket', 'polling'],
        path: '/socket.io/'
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

            socket.on('disconnect', () => {
                // Clean up maps
                for (const [userId, socketId] of userSockets.entries()) {
                    if (socketId === socket.id) userSockets.delete(userId);
                }
                for (const [providerId, socketId] of providerSockets.entries()) {
                    if (socketId === socket.id) providerSockets.delete(providerId);
                }
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
        isProviderOnline: (providerId: string) => providerSockets.has(providerId)
    };
}