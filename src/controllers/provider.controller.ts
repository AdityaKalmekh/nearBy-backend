import { Response, Request } from "express";
import { Provider } from "../models/Provider";
import { ProviderLocation } from "../models/ProviderLocation";
import { User } from "../models/User";
import { UserStatus } from "../types/user.types";

export const createProvider = async (req: Request, res: Response) => {
    try {
        const providerData = req.body;
        const ProviderDetail = new Provider({
            userId: req.user?.userId,
            services: providerData.selectedServices,
            baseLocation: { ...providerData.locationDetails, type: 'Point', lastUpdated: new Date() }
        });

        const saveProvider = await ProviderDetail.save();
        try {
            if (saveProvider) {
                const Location = new ProviderLocation({
                    providerId: saveProvider._id,
                    currentLocation: { ...providerData.locationDetails, type: 'Point', lastUpdated: new Date() },
                    isActive: true
                })

                const saveLocation = await Location.save();
                if (!saveLocation) {
                    await Provider.findByIdAndDelete(saveProvider._id);
                    throw new Error('Failed to create provider or location');
                }

                try {
                    const updateUser = await User.findByIdAndUpdate(
                        req.user?.userId,
                        { status: UserStatus.ACTIVE },
                        { new: true }
                    )

                    if (!updateUser) {
                        // If user update fails, rollback previous operations
                        await Provider.findByIdAndDelete(saveProvider._id);
                        await ProviderLocation.findByIdAndDelete(saveLocation._id);
                        throw new Error('Failed to update user status');
                    }

                    // res.cookie('User_Data', JSON.stringify({
                    //     ...JSON.parse(req.cookies.User_Data),
                    //     providerId: saveLocation.providerId,
                    //     status: UserStatus.ACTIVE,
                    // }), {
                    //     secure: process.env.NODE_ENV === "production",
                    //     sameSite: process.env.NODE_ENV === "production" ? 'none' : 'strict',
                    //     maxAge: 24 * 60 * 60 * 1000,
                    //     path: '/',
                    //     httpOnly: false,
                    // });

                    return res.status(201).json({
                        success: true,
                        message: 'Provider created successfully',
                        providerId: saveLocation.providerId
                    });
                } catch (userUpdateError) {
                    await Provider.findByIdAndDelete(saveProvider._id);
                    await ProviderLocation.findByIdAndDelete(saveLocation._id);
                    throw userUpdateError;
                }
            }
        } catch (locationError) {
            await Provider.findByIdAndDelete(saveProvider._id);
            throw locationError;
        }
    } catch (error) {
        console.error('Error in createProvider:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
}