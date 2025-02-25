import { Types, Document } from "mongoose";

export enum ProviderStatus {
    ONLINE = 'ONLINE',
    OFFLINE = 'OFFLINE',
    BUSY = 'BUSY'
}

export interface IProvider extends Document {
    _id: Types.ObjectId,
    userId: Types.ObjectId,
    status: ProviderStatus,
    services: Array<{
        // serviceId: Types.ObjectId,
        serviceType: string,
        visitingCharge? : number,
    }>
    serviceArea: {
        type: string,
        coordinates: number[],
        radius: number
    },
    baseLocation: {
        type: string,
        coordinates: number[],
        source: string,
        accuracy: number,
        lastUpdated: Date,
        address: string,
        city: string,
        state: string,
        country: string,
        pincode: string,
    },
    rating: {
        average: number,
        count: number
    },
    completedServices: number,
    cancelledServices: number,
}