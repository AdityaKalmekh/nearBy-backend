// import { createSocketServer } from "../configs/socketServer";
import { socketServer } from "../main";

export function notificationService() {
    const notifyProvider = async (providerId: string, event: string, data: any) => {
        // 'new:request'
        const isOnline = socketServer.isProviderOnline(providerId);
        socketServer.emitToProvider(providerId, event, data);

        if (!isOnline) {
            await sendPushNotification(providerId, 'New Request Available');
        }
    };

    const notifyRequester = async (userId: string, status: string, providerId?: any) => {
        socketServer.emitToUser(userId, 'request:update', {
            status,
            providerId
        });
    };

    const sendPushNotification = async (userId: string, message: string) => {
        // Implement push notification logic
    };

    return {
        notifyProvider,
        notifyRequester
    };
}