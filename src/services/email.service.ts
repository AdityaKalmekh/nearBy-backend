import { emailTransporter } from "../configs/email";
import { getOTPEmailTemplate } from "../utils/emailTemplates";

export const sendEmail = async (email: string, otp: string): Promise<void> => {
    try {
        const mailOptions = {
            from: `'"NearBy" <${process.env.EMAIL_USER}>'`,
            to: email,
            subject: 'Your NearBy account verification code',
            html: getOTPEmailTemplate(otp)
        };

        await emailTransporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Email service error:', error);
        throw new Error('Failed to send email');
    }
};