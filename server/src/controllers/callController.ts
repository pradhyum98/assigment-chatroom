import { Request, Response } from 'express';
import { CallLog } from '../models/CallLog';
import { ChatRoom } from '../models/ChatRoom';
import { logger } from '../middleware/logger';

export const getCallLogs = async (req: Request, res: Response): Promise<any> => {
  try {
    const { roomId } = req.params;
    const userId = (req as any).user.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const room = await ChatRoom.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    const isMember = room.participants.some(p => p.toString() === userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const calls = await CallLog.find({ roomId })
      .sort({ startedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('callerId', 'firstName lastName avatarUrl')
      .populate('receiverId', 'firstName lastName avatarUrl')
      .lean();

    const total = await CallLog.countDocuments({ roomId });

    res.json({
      success: true,
      data: {
        calls,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err: any) {
    logger.error('Failed to fetch call logs:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch call logs' });
  }
};

export const getIceServers = async (req: Request, res: Response): Promise<any> => {
  try {
    // In a real production scenario, this might integrate with Twilio Network Traversal Service 
    // or Metered TURN, generating short-lived credentials.
    // For now, we return a hardened STUN/TURN config.
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // Optional: Add TURN server config here from ENV variables
      ...(process.env.TURN_SERVER_URL ? [{
        urls: process.env.TURN_SERVER_URL,
        username: process.env.TURN_SERVER_USER || '',
        credential: process.env.TURN_SERVER_PASSWORD || ''
      }] : [])
    ];

    res.json({
      success: true,
      data: { iceServers }
    });
  } catch (err: any) {
    logger.error('Failed to fetch ICE servers:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch ICE servers' });
  }
};
