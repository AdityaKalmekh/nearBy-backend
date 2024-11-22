import mongoose, { Schema } from "mongoose";
import { IProviderLocation } from "../types/providerLocation.types";

const ProviderLocationSchema = new Schema<IProviderLocation>(
    {
        providerId: {
            type: Schema.Types.ObjectId,
            ref: 'Provider',
            required: true,
            unique: true,
            index: true
        },
        currentLocation: {
            type: {
                type: String,
                enum: ['Point'],
                required: true
            },
            coordinates: {
                type: [Number],
                required: true
            },
            source: {
                type: String,
                required: true
            },
            accuracy: {
                type: Number,
                required: true
            },
            lastUpdated: {
                type: Date,
                required: true,
                index: true
            }
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        },
        deviceInfo: {
            deviceId: String,
            platform: String
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

ProviderLocationSchema.index({ 'currentLocation': '2dsphere'});
export const ProviderLocation = mongoose.model<IProviderLocation>('ProviderLocation', ProviderLocationSchema);