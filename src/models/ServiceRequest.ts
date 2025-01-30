import mongoose, { Schema } from "mongoose";
import { IServiceRequest, ServiceStatus } from "../types/servicerequest.types";

const ServiceRequestSchema = new Schema<IServiceRequest>(
    {
        provider: {
            type: Schema.Types.ObjectId,
            ref: 'Provider',
            index: true
        },
        requester: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        services: [{
            type: String,
            // ref: 'Service',
            required: true
        }],
        status: {
            type: String,
            enum: ServiceStatus,
            default: ServiceStatus.PENDING,
            index: true
        },
        startTime: Date,
        endTime: Date,
        address: {
            type: String,
        },
        availableProviders:[{
            providerId: {
                type: String
            },
            distance: {
                type: Number
            }
        }]
        ,
        location: {
            type: {
                type: String,
                enum: ['Point'],
                required: true
            },
            coordinates: {
                type: [Number],
                required: true
            }
        },
        searchAttempts: {
            type: Number,
            default: 0
        },
        estimatedDistance: Number,
        otpVerified: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

ServiceRequestSchema.index({ location: '2dsphere' });
export const ServiceRequest = mongoose.model<IServiceRequest>("ServiceRequest", ServiceRequestSchema);