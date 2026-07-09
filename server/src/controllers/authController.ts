import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { RefreshSession } from '../models/RefreshSession';
import { ChatRoom } from '../models/ChatRoom';
import { IdentityTransition } from '../models/IdentityTransition';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../middleware/logger';
import { signToken, signAccessToken, signRefreshToken, hashRefreshToken, setRefreshTokenCookie, clearRefreshTokenCookie, verifyToken } from '../utils/auth';
import { mapUserResponse } from '../utils/user';
import { AuthRequest } from '../types';
import { auditLog } from '../utils/auditLogger';
import { getEmailService } from '../services/EmailService';
import { getSocketRevocationService } from '../services/SocketRevocationService';

const signupSchema = z.object({
  firstName: z.string().min(2, 'First name is required (min 2 characters)').max(50),
  lastName: z.string().min(2, 'Last name is required (min 2 characters)').max(50),
  email: z.string().email('Please provide a valid email'),
  password: z.string().min(6, 'Password must be at least 6 letters long'),
  publicKey: z.string().optional(),
  encryptedPrivateKey: z.object({
    ciphertext: z.string(),
    iv: z.string(),
  }).optional(),
});

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required to continue'),
  publicKey: z.string().optional(),
});

// Helper to create and persist a new refresh session in the database
async function createRefreshSession(
  userId: string,
  familyId: string | null,
  parentTokenId: string | null,
  req: Request
): Promise<{ refreshToken: string; tokenId: string; familyId: string }> {
  const finalFamilyId = familyId || crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  
  // Refresh token is a self-describing JWT carrying familyId and tokenId
  const refreshToken = signRefreshToken({ userId, tokenId, familyId: finalFamilyId });
  const tokenHash = hashRefreshToken(refreshToken);

  await RefreshSession.create({
    userId,
    familyId: finalFamilyId,
    tokenId,
    tokenHash,
    parentTokenId,
    replacedByTokenId: null,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    deviceLabel: req.headers['user-agent'] || 'Unknown Device',
    ipAddress: req.ip || '',
  });

  return { refreshToken, tokenId, familyId: finalFamilyId };
}

export const signup = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { success, data, error } = signupSchema.safeParse(req.body);

    if (!success) {
      throw new AppError(error.errors[0].message, 400);
    }

    const { firstName, lastName, email, password, publicKey, encryptedPrivateKey } = data;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      auditLog.loginFailed(email, req.ip || '', 'Duplicate registration attempt');
      throw new AppError('This email is already registered. Try logging in instead.', 409);
    }

    const user = await User.create({ 
      firstName, 
      lastName, 
      email, 
      password, 
      publicKey, 
      encryptedPrivateKey
    });
    const accessToken = signAccessToken({ userId: user._id.toString(), email: user.email });
    const { refreshToken } = await createRefreshSession(user._id.toString(), null, null, req);

    setRefreshTokenCookie(req, res, refreshToken);

    auditLog.registrationSuccess(email, req.ip || '');

    res.status(201).json({
      success: true,
      message: 'Account created!',
      data: {
        token: accessToken,
        user: mapUserResponse(user),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const ip = req.ip || '';
  let attemptedEmail = '';
  try {
    const { success, data, error } = loginSchema.safeParse(req.body);

    if (!success) {
      throw new AppError(error.errors[0].message, 400);
    }

    const { email, password, publicKey } = data;
    attemptedEmail = email;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      auditLog.loginFailed(attemptedEmail, ip, 'Invalid email or password');
      throw new AppError('Incorrect email or password combination.', 401);
    }

    // Update public key if provided (new device login)
    if (publicKey && user.publicKey !== publicKey) {
      user.publicKey = publicKey;
      await user.save();
    }

    const accessToken = signAccessToken({ userId: user._id.toString(), email: user.email });
    const { refreshToken } = await createRefreshSession(user._id.toString(), null, null, req);

    setRefreshTokenCookie(req, res, refreshToken);

    auditLog.loginSuccess(email, ip);

    res.status(200).json({
      success: true,
      message: 'Welcome back!',
      data: {
        token: accessToken,
        user: mapUserResponse(user),
      },
    });
  } catch (error) {
    if (attemptedEmail && !(error instanceof AppError)) {
      auditLog.loginFailed(attemptedEmail, ip, 'Error during login process');
    }
    next(error);
  }
};

export const getMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Session not found', 401);
    }

    res.status(200).json({
      success: true,
      message: 'Successfully pulled user profile',
      data: { user: req.user },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    let revokedUserId: string | null = null;
    if (refreshToken) {
      const hash = hashRefreshToken(refreshToken);
      // DB revocation commits first; socket disconnect happens after
      const updated = await RefreshSession.findOneAndUpdate(
        { tokenHash: hash },
        { revokedAt: new Date(), revocationReason: 'logout' },
        { new: true }
      );
      if (updated) {
        revokedUserId = updated.userId.toString();
      }
    }
    clearRefreshTokenCookie(req, res);

    // Post-commit: revoke active sockets. Failure here is non-fatal.
    if (revokedUserId) {
      try {
        const revSvc = getSocketRevocationService();
        revSvc?.revokeUser(revokedUserId, {
          reason: 'logout',
          message: 'You have been logged out.',
        });
      } catch (socketErr) {
        logger.error('[logout] Socket revocation failed (DB revocation still authoritative):', socketErr);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const refresh = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new AppError('Refresh token is missing.', 401);
    }

    let decodedPayload: any;
    try {
      decodedPayload = verifyToken(refreshToken);
    } catch (err) {
      throw new AppError('Invalid or expired refresh token.', 401);
    }

    const hash = hashRefreshToken(refreshToken);

    // Look up the refresh session in the database
    const session = await RefreshSession.findOne({ tokenHash: hash });
    if (!session) {
      throw new AppError('Refresh session not found.', 401);
    }

    // Check if session has already been consumed or revoked (indicating replay attack)
    if (session.revokedAt || session.usedAt) {
      // REPLAY DETECTED! Revoke the entire session family tree immediately
      await RefreshSession.updateMany(
        { familyId: session.familyId },
        { revokedAt: new Date(), revocationReason: 'replay_detected' }
      );
      clearRefreshTokenCookie(req, res);

      // Post-commit: revoke all active sockets for this user
      try {
        const revSvc = getSocketRevocationService();
        revSvc?.revokeUser(session.userId.toString(), {
          reason: 'replay_detected',
          message: 'Your session has been revoked due to a security violation. Please log in again.',
        });
      } catch (socketErr) {
        logger.error('[refresh/replay] Socket revocation failed (DB revocation still authoritative):', socketErr);
      }

      throw new AppError('Session revoked due to replay detection.', 401);
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new AppError('Refresh token expired.', 401);
    }

    const user = await User.findById(decodedPayload.userId);
    if (!user) {
      throw new AppError('User belonging to this token no longer exists.', 401);
    }

    // Perform atomic rotation
    const newAccessToken = signAccessToken({ userId: user._id.toString(), email: user.email });
    const { refreshToken: newRefreshToken } = await createRefreshSession(
      user._id.toString(),
      session.familyId,
      session.tokenId,
      req
    );

    // Consume old session atomically
    const replaced = await RefreshSession.findOneAndUpdate(
      { _id: session._id, usedAt: null },
      { 
        $set: { 
          usedAt: new Date(), 
          replacedByTokenId: verifyToken(newRefreshToken).tokenId 
        } 
      }
    );

    if (!replaced) {
      // Race condition detected! Another concurrent request consumed it first.
      await RefreshSession.updateMany(
        { familyId: session.familyId },
        { revokedAt: new Date(), revocationReason: 'replay_detected' }
      );
      clearRefreshTokenCookie(req, res);
      throw new AppError('Session revoked due to replay detection.', 401);
    }

    setRefreshTokenCookie(req, res, newRefreshToken);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully.',
      data: {
        token: newAccessToken,
        user: mapUserResponse(user)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      throw new AppError('New password must be at least 6 characters', 400);
    }

    const user = await User.findById(req.user?._id);
    if (!user) throw new AppError('User not found', 404);

    user.password = newPassword;
    await user.save();

    // Revoke all refresh sessions on password change
    await RefreshSession.updateMany(
      { userId: user._id },
      { revokedAt: new Date(), revocationReason: 'password_reset' }
    );

    res.status(200).json({
      success: true,
      message: 'Password successfully changed and sessions revoked.',
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      throw new AppError('Please provide an email address', 400);
    }

    const user = await User.findOne({ email });
    if (!user) {
      res.status(200).json({
        success: true,
        message: 'If that email is registered, a password reset link has been sent.',
      });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');

    user.passwordResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.passwordResetExpires = new Date(Date.now() + 3600000); // 1 hour expiry

    await user.save();

    const emailService = getEmailService();
    const mailResult = await emailService.sendPasswordResetEmail(user.email, resetToken);

    const responseData: any = {
      success: true,
      message: 'If that email is registered, a password reset link has been sent.',
    };

    const allowDevToken = process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE === 'true';
    if (process.env.NODE_ENV !== 'production' && allowDevToken && mailResult.devResetToken) {
      responseData.devResetToken = mailResult.devResetToken;
    }

    res.status(200).json(responseData);
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      throw new AppError('Token and new password are required', 400);
    }

    if (newPassword.length < 6) {
      throw new AppError('Password must be at least 6 characters', 400);
    }

    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() }
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      throw new AppError('Password reset token is invalid or has expired.', 400);
    }

    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save();

    // Revoke all refresh sessions on password reset
    await RefreshSession.updateMany(
      { userId: user._id },
      { revokedAt: new Date(), revocationReason: 'password_reset' }
    );

    res.status(200).json({
      success: true,
      message: 'Password successfully reset.',
    });
  } catch (error) {
    next(error);
  }
};

export const logoutAll = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Authentication required.', 401);
    }

    // DB revocation commits first
    await RefreshSession.updateMany(
      { userId: req.user._id },
      { revokedAt: new Date(), revocationReason: 'logout_all' }
    );

    clearRefreshTokenCookie(req, res);

    // Post-commit: revoke all active sockets for this user
    try {
      const revSvc = getSocketRevocationService();
      revSvc?.revokeUser(req.user._id.toString(), {
        reason: 'logout_all',
        message: 'You have been logged out from all sessions.',
      });
    } catch (socketErr) {
      logger.error('[logoutAll] Socket revocation failed (DB revocation still authoritative):', socketErr);
    }

    res.status(200).json({
      success: true,
      message: 'Logged out from all sessions successfully.',
    });
  } catch (error) {
    next(error);
  }
};

export const listSessions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Authentication required.', 401);
    }

    const sessions = await RefreshSession.find({
      userId: req.user._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    }).select('-tokenHash');

    res.status(200).json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    next(error);
  }
};

export const revokeSession = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Authentication required.', 401);
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      throw new AppError('Session ID is required.', 400);
    }

    const session = await RefreshSession.findOne({
      _id: sessionId,
      userId: req.user._id
    });

    if (!session) {
      throw new AppError('Session not found.', 404);
    }

    session.revokedAt = new Date();
    session.revocationReason = 'logout';
    await session.save();

    // Post-commit: best-effort socket revocation
    try {
      const revSvc = getSocketRevocationService();
      revSvc?.revokeUser(req.user._id.toString(), {
        reason: 'logout',
        message: 'One of your sessions has been revoked.',
      });
    } catch (socketErr) {
      logger.error('[revokeSession] Socket revocation failed:', socketErr);
    }

    res.status(200).json({
      success: true,
      message: 'Session revoked successfully.',
    });
  } catch (error) {
    next(error);
  }
};

export const resetIdentity = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    if (!req.user) {
      throw new AppError('Authentication required.', 401);
    }

    const { publicKey, encryptedPrivateKey } = req.body;
    if (!publicKey || !encryptedPrivateKey || !encryptedPrivateKey.ciphertext || !encryptedPrivateKey.iv) {
      throw new AppError('Invalid E2EE identity payload.', 400);
    }

    const user = await User.findById(req.user._id).session(session);
    if (!user) {
      throw new AppError('User not found.', 404);
    }

    const previousIdentityVersion = user.identityVersion || 1;
    user.publicKey = publicKey;
    user.encryptedPrivateKey = encryptedPrivateKey;
    user.identityVersion = previousIdentityVersion + 1;

    await user.save({ session });

    // Revoke all other refresh sessions (since E2EE identity reset is highly sensitive)
    await RefreshSession.updateMany(
      { userId: user._id },
      { revokedAt: new Date(), revocationReason: 'password_reset' },
      { session }
    );

    const rooms = await ChatRoom.find({ participants: user._id }).session(session);

    const { SequenceService } = await import('../services/SequenceService');
    const { RoomEvent, RoomEventType } = await import('../models/RoomEvent');
    const { UserEvent, UserEventType } = await import('../models/UserEvent');

    const generatedRoomEvents: any[] = [];
    
    const transitionPromises = rooms.map(async (room) => {
      // Create a durable transition record
      await IdentityTransition.create([{
        userId: user._id,
        roomId: room._id,
        previousIdentityVersion,
        newIdentityVersion: user.identityVersion,
        requiredMembershipRevision: room.membershipRevision,
        previousRoomKeyVersion: room.roomKeyVersion,
        status: 'PENDING'
      }], { session });

      let neededEventsCount = 1;
      const needsRotation = room.cryptoState !== 'ROTATION_REQUIRED';
      if (needsRotation) {
        neededEventsCount = 2;
        room.cryptoState = 'ROTATION_REQUIRED';
        await room.save({ session });
      }

      const startSeq = await SequenceService.allocateRoomSequence(room.roomId, neededEventsCount, session);
      
      const identityEvent = new RoomEvent({
        roomId: room.roomId,
        sequenceNumber: startSeq,
        eventType: RoomEventType.IDENTITY_CHANGED,
        eventVersion: 1,
        actorId: user._id.toString(),
        payload: {
          userId: user._id.toString(),
          previousIdentityVersion,
          newIdentityVersion: user.identityVersion,
          identityVersion: user.identityVersion,
          publicKey
        }
      });
      generatedRoomEvents.push(identityEvent);

      if (needsRotation) {
        const rotationEvent = new RoomEvent({
          roomId: room.roomId,
          sequenceNumber: startSeq + 1,
          eventType: RoomEventType.ROOM_KEY_ROTATION_REQUIRED,
          eventVersion: 1,
          actorId: user._id.toString(),
          payload: {
            membershipRevision: room.membershipRevision,
            roomKeyVersion: room.roomKeyVersion
          }
        });
        generatedRoomEvents.push(rotationEvent);
      }
    });

    await Promise.all(transitionPromises);

    if (generatedRoomEvents.length > 0) {
      await RoomEvent.insertMany(generatedRoomEvents, { session });
    }

    const startUserSeq = await SequenceService.allocateUserSequence(user._id.toString(), 1, session);
    const userEvent = new UserEvent({
      userId: user._id.toString(),
      sequenceNumber: startUserSeq,
      eventType: UserEventType.IDENTITY_RESET,
      eventVersion: 1,
      payload: {
        newIdentityVersion: user.identityVersion,
        timestamp: new Date()
      }
    });
    await UserEvent.create([userEvent], { session });

    await session.commitTransaction();
    session.endSession();

    // Post-commit: revoke all active sockets (identity reset is high-severity)
    try {
      const revSvc = getSocketRevocationService();
      revSvc?.revokeUser(user._id.toString(), {
        reason: 'identity_reset',
        message: 'Your E2EE identity has been reset. Please log in again to restore your keys.',
      });
    } catch (socketErr) {
      logger.error('[resetIdentity] Socket revocation failed (DB revocation still authoritative):', socketErr);
    }

    const { getIo } = await import('../socket');
    const io = getIo();
    if (io) {
      io.to(user._id.toString()).emit('user_event', { events: [userEvent.toJSON()] });
      // For rooms, group events by roomId and emit
      const roomEventsByRoom = generatedRoomEvents.reduce((acc, ev) => {
        if (!acc[ev.roomId]) acc[ev.roomId] = [];
        acc[ev.roomId].push(ev.toJSON());
        return acc;
      }, {} as Record<string, any[]>);

      for (const [rId, evs] of Object.entries(roomEventsByRoom)) {
        io.to(rId).emit('room_event', { events: evs });
      }
    }

    res.status(200).json({
      success: true,
      message: 'E2EE identity successfully reset, sessions revoked, and room reconciliations queued.',
      data: {
        user: mapUserResponse(user),
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
