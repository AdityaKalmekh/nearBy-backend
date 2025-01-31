import CryptoJS from 'crypto-js';
import { Types } from 'mongoose';

interface EncryptedData {
    data: string;
    iv: string;
}

interface EncryptedIdData {
    ciphertext: string;
    iv: string;
    salt: string;
}

interface EncryptionResult {
    encryptedData: string;
    encryptionKey: string;
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

const generateRandomIV = (length: number = 16): string => {
    return CryptoJS.lib.WordArray.random(length).toString();
};

const encryptId = (id: string): EncryptionResult => {
    const encryptionKey = generateSecureKey();
    const iv = generateRandomIV();
    const salt = CryptoJS.lib.WordArray.random(128 / 8);

    // Create key and IV from password and salt
    const key = CryptoJS.PBKDF2(encryptionKey, salt, {
        keySize: 256 / 32,
        iterations: 1000
    });

    // Encrypt
    const encrypted = CryptoJS.AES.encrypt(id, key, {
        iv: CryptoJS.enc.Hex.parse(iv),
        padding: CryptoJS.pad.Pkcs7,
        mode: CryptoJS.mode.CBC
    });

    const encryptedData: EncryptedIdData = {
        ciphertext: encrypted.ciphertext.toString(),
        iv: iv,
        salt: salt.toString()
    };

    return {
        encryptedData: JSON.stringify(encryptedData),
        encryptionKey
    };
};

export const encryptUserId = (userId: string): { encryptedUId: string; encryptionKey: string; } => {
    const { encryptedData, encryptionKey } = encryptId(userId);
    return {
        encryptedUId: encryptedData,
        encryptionKey
    };
};

export const encryptProviderId = (providerId: string): { encryptedPId: string; encryptionPKey: string; } => {
    const { encryptedData, encryptionKey } = encryptId(providerId);
    return {
        encryptedPId: encryptedData,
        encryptionPKey: encryptionKey
    };
};