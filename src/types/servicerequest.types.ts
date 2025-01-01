import { Document, Types } from "mongoose";

export enum ServiceStatus {
    PENDING = 'PENDING',
    SEARCHING = 'SEARCHING',     // Added: When looking for providers
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
    NO_PROVIDER = 'NO_PROVIDER'
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
    location: {
        type: string,
        coordinates: number[]
    };
    availableProviders : Array<{
        providerId: string;
        distance: number;
    }>;
    searchAttempts: number;
    estimatedDistance?: number;
    createdAt: Date;
    updatedAt: Date;
}