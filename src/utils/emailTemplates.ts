export const getOTPEmailTemplate = (otp: string, isNewUser: boolean, firstName: string | undefined): string => {
    return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #000000;">
            <!-- Main Content -->
            <div style="background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <h1 style="color: #000000; font-size: 32px; margin: 0 0 30px 0; font-weight: normal;">
                    Your <span style="background-color: #EDF2F7; padding: 2px 6px; border-radius: 4px;">NearBy</span> verification code
                </h1>
                
                ${!isNewUser ? `<p style="color: #000000; font-size: 18px; margin: 0 0 20px 0;">Hi ${firstName},</p>`: ''}
                
                <p style="color: #000000; font-size: 18px; margin: 0 0 30px 0;">
                    To finish logging in to your <span style="background-color: #EDF2F7; padding: 2px 6px; border-radius: 4px;">NearBy</span> account, enter this verification code:
                </p>
                
                <!-- Code Display -->
                <div style="margin: 30px 0;">
                    <h2 style="color: #000000; font-size: 36px; font-weight: bold; margin: 0;">${otp}</h2>
                </div>
                
                <!-- Security Notice -->
                <p style="color: #000000; font-size: 18px; margin: 30px 0 0 0; font-weight: bold;">
                    Do not share this code with anyone. <span style="background-color: #EDF2F7; padding: 2px 6px; border-radius: 4px;">NearBy</span> staff will never ask you for this code.
                </p>

                <!-- Additional Security Message -->
                <p style="color: #666666; font-size: 16px; margin: 20px 0 0 0; line-height: 1.5;">
                    If you didn't request this OTP, please ignore this email. Your account security is important to us.
                </p>
            </div>

            <!-- Footer -->
            <div style="text-align: center; padding-top: 20px;">
                <p style="color: #FFFFFF; font-size: 14px; margin: 0 0 10px 0;">
                    © ${new Date().getFullYear()} NearBy. All rights reserved.
                </p>
                <p style="color: #FFFFFF; font-size: 12px; margin: 0;">
                    This is an automated message, please do not reply to this email.
                </p>
            </div>
        </div>
    `;
};