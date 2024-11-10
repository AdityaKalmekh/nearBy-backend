import { UserRole } from "../types/user.types";

export const convertStringToUserRole = (roleStr: string): UserRole => {
    const role = roleStr.toLowerCase();
    switch (role) {
        case 'provider':
            return UserRole.provider;
        case 'requester':
            return UserRole.requester;
        case 'admin':
            return UserRole.ADMIN;
        default:
            throw new Error(`Invalid role: ${roleStr}`);
    }
};