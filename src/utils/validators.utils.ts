export const isValidEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const isValidPhone = (phoneNo: string): boolean => {
    return /^\d{10}$/.test(phoneNo);
};