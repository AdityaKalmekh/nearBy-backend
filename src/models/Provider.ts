import mongoose, { Schema } from "mongoose";
import { IProvider, ProviderStatus } from "../types/provider.types";
import { Point } from 'geojson';

const ProviderSchema = new Schema<IProvider>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true
        },
        services: [{
            // serviceId: {
            //     type: Schema.Types.ObjectId,
            //     ref: 'Service',
            //     required: true
            // },
            serviceType: { type: String, required: true },
            visitingCharge: { type: Number, required: true }
        }],
        status: {
            type: String,
            enum: ProviderStatus,
            default: ProviderStatus.OFFLINE,
            index: true
        },
        baseLocation: {
            type: {
                type: String,
                enum: ['Point']
            },
            coordinates: {
                type: [Number]
            },
            source: {
                type: String
            },
            accuracy: {
                type: Number
            },
            lastUpdated: {
                type: Date
            },
            address: String,
            city: { type: String, index: true },
            state: String,
            country: String,
            pincode: String
        },
        rating: {
            average: {
                type: Number,
                default: 0
            },
            count: {
                type: Number,
                default: 0
            }
        },
        completedServices: {
            type: Number,
            default: 0
        },
        cancelledServices: {
            type: Number,
            default: 0
        }
    }
)

ProviderSchema.index({ baseLocation: '2dsphere' });
export const Provider = mongoose.model<IProvider>("Provider", ProviderSchema);