import { Document, Types } from "mongoose";

export interface IProviderLocation extends Document {
    providerId: Types.ObjectId,
    currentLocation: {
        type: string,
        coordinates: number[],
        source: string,
        accuracy: number,
        lastUpdated: Date,
    },
    isActive: boolean,
    deviceInfo: {
        deviceId: string,
        platform: string,
    }
}