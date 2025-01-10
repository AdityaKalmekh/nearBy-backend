import { emailTransporter } from "../configs/email";
import { getOTPEmailTemplate } from "../utils/emailTemplates";
import { SendMailOptions } from "nodemailer";

export const sendEmail = async (email: string, otp: string): Promise<void> => {
    try {
        const mailOptions: SendMailOptions = {
            from: `"NearBy" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Your NearBy account verification code',
            priority: 'high',
            headers: {
                'List-Unsubscribe': `<mailto:${process.env.EMAIL_USER}>`,
                'Feedback-ID': 'OTP:nearby',
                'X-Entity-Ref-ID': `nearby-otp-${Date.now()}` // Unique identifier for each email
            },
            text: `Your NearBy verification code is: ${otp}. This code will expire in 10 minutes.`,
            html: getOTPEmailTemplate(otp)
        };

        await emailTransporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Email service error:', error);
        throw new Error('Failed to send email');
    }
};