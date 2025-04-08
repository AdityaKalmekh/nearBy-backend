import { Document, Types } from "mongoose";

export enum ServiceStatus {
    PENDING = 'PENDING',
    SEARCHING = 'SEARCHING',     // Added: When looking for providers
    COLLECTION = 'COLLECTION',
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
    NO_PROVIDER = 'NO_PROVIDER',
    STARTED = 'STARTED'
}


export interface IServiceRequest extends Document {
    provider?: Types.ObjectId;
    requester: Types.ObjectId;
    services: Array<{
        serviceType: string,
        visitingCharge: number 
    }>;
    status: ServiceStatus;
    startTime?: Date;                 // Optional initially
    endTime?: Date;
    address?: string;
    reqLocation: {
        type: string,
        coordinates: number[]
    };
    prvLocation?: {
        type: string,
        coordinates: number[]
    };
    availableProviders : Array<{
        providerId: string;
        distance: number;
    }>;
    searchAttempts: number;
    estimatedDistance?: number;
    otpVerified?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface ProviderAcceptance {
    providerId: string;
    distance: number;
    timestamp: number;
}

export interface ProviderWithDistance {
    providerId: string;
    distance: number;
    coordinates?: {
        latitude: number | string;
        longitude: number | string;
    };
}
export interface RequesterLocation {
    longitude: number;
    latitude: number;
}