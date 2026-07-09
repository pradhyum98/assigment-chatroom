import { logger } from '../middleware/logger';

export interface EmailService {
  sendPasswordResetEmail(email: string, token: string): Promise<{ success: boolean; devResetToken?: string }>;
}

export class DevelopmentEmailService implements EmailService {
  async sendPasswordResetEmail(email: string, token: string): Promise<{ success: boolean; devResetToken?: string }> {
    logger.info(`[DEV EMAIL] Sending password reset email request for user: ${email}`);
    
    const allowDevToken = process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE === 'true';
    if (allowDevToken) {
      logger.info(`[DEV EMAIL] Reset Token: ${token}`);
      return { success: true, devResetToken: token };
    }
    
    logger.info(`[DEV EMAIL] Reset email request received but ALLOW_DEV_RESET_TOKEN_RESPONSE is not enabled. Token value is hidden.`);
    return { success: true };
  }
}

export class ProductionEmailService implements EmailService {
  async sendPasswordResetEmail(email: string, token: string): Promise<{ success: boolean; devResetToken?: string }> {
    logger.info(`[PROD EMAIL] Routing password reset mail delivery for: ${email} via SMTP/Vendor gateway.`);
    // Production email integration (SendGrid, Mailgun, Amazon SES) will be wired here.
    // Never expose reset tokens in the response or logs in production.
    return { success: true };
  }
}

export function getEmailService(): EmailService {
  if (process.env.NODE_ENV === 'production') {
    return new ProductionEmailService();
  }
  return new DevelopmentEmailService();
}
