export interface RequestData {
    requestId: string;
    userId: string;
    services: Array<{
        serviceType: string,
        visitingCharge: number
    }>;
    latitude: number,
    longitude: number,
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED' | 'NO_PROVIDER' | 'INPROCESS';
    currentProvider?: string;
    attempts: number;
    createdAt: number;
}

export interface ProviderWithDistance {
    providerId: string;
    distance: number;
}