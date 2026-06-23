import { logger } from '../middleware/logger';

/**
 * Audit logger helper for recording security-sensitive events.
 * Strips password details, messages, and raw secrets from logs.
 */
export const auditLog = {
  loginSuccess: (email: string, ip: string) => {
    logger.info(`[SECURITY AUDIT] Login successful. User Email: ${email} | IP: ${ip}`);
  },
  loginFailed: (email: string, ip: string, reason: string) => {
    logger.warn(`[SECURITY AUDIT] Login failed. Attempted Email: ${email} | IP: ${ip} | Reason: ${reason}`);
  },
  registrationSuccess: (email: string, ip: string) => {
    logger.info(`[SECURITY AUDIT] User registered. Email: ${email} | IP: ${ip}`);
  },
  friendRequestCreated: (senderEmail: string, recipientId: string) => {
    logger.info(`[SECURITY AUDIT] Friend request sent. Sender: ${senderEmail} -> Recipient ID: ${recipientId}`);
  },
  friendRequestResponded: (requestId: string, recipientEmail: string, action: 'accept' | 'reject') => {
    logger.info(`[SECURITY AUDIT] Friend request processed. Request ID: ${requestId} | By: ${recipientEmail} | Action: ${action}`);
  },
  dmRoomCreated: (roomId: string, createdByEmail: string, participantIds: string[]) => {
    logger.info(
      `[SECURITY AUDIT] DM Room created. Room ID: ${roomId} | Created By: ${createdByEmail} | Participants: [${participantIds.join(', ')}]`
    );
  },
  authorizationFailure: (userEmail: string, action: string, resourceId: string) => {
    logger.error(
      `[SECURITY AUDIT] Authorization bypass BLOCKED. User: ${userEmail} | Action: ${action} | Resource ID: ${resourceId}`
    );
  },
  invalidToken: (ip: string, error: string) => {
    logger.warn(`[SECURITY AUDIT] Invalid JWT parsed. IP: ${ip} | Error: ${error}`);
  },
  rateLimitViolation: (ip: string, category: string, url: string) => {
    logger.warn(`[SECURITY AUDIT] Rate limit violation. IP: ${ip} | Category: ${category} | URL: ${url}`);
  },
  passwordRecoveryAccessed: (adminEmail: string, userId: string, reason: string) => {
    logger.warn(`[SECURITY AUDIT] ACCOUNT RECOVERY INVOKED. Admin: ${adminEmail} | Target User: ${userId} | Reason: ${reason}`);
  },
};
