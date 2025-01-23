import CryptoJS from 'crypto-js';
import { Types } from 'mongoose';

interface EncryptedData {
    data: string;
    iv: string;
}

interface UserData {
    userId: Types.ObjectId,
    firstName?: String,
    authType: String,
    role: number,
    isNewUser: boolean,
    contactOrEmail: String
}

export const encryptUserData = (data: UserData, secretKey: string): EncryptedData => {
    try {
        // Generate random IV
        const iv = CryptoJS.lib.WordArray.random(16);

        // Encrypt the data
        const encrypted = CryptoJS.AES.encrypt(
            JSON.stringify(data),
            secretKey,
            {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            }
        );

        return {
            data: encrypted.toString(),
            iv: iv.toString()
        };
    } catch (error) {
        console.error('Encryption error:', error);
        throw new Error('Failed to encrypt user data');
    }
};

export const generateSecureKey = (): string => {
    return CryptoJS.lib.WordArray.random(32).toString();
};
