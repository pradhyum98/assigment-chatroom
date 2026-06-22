import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { FriendRequest } from '../models/FriendRequest';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { auditLog } from '../utils/auditLogger';

/**
 * Helper to validate MongoDB ObjectId
 */
const isValidObjectId = (id: string): boolean => {
  return mongoose.Types.ObjectId.isValid(id);
};

/**
 * Search for users to add as friends.
 * Excludes: current user, existing friends, and users with pending requests.
 * Excludes sensitive fields (like emails and internal timestamps) to minimize PII.
 */
export const searchUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const queryStr = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (!queryStr) {
      res.status(200).json({ success: true, data: { users: [] } });
      return;
    }

    // Input Validation: Reject oversized queries
    if (queryStr.length > 100) {
      throw new AppError('Search query is too long. Maximum length is 100 characters.', 400);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const skip = (page - 1) * limit;

    // Get all pending friend requests involving the current user
    const pendingRequests = await FriendRequest.find({
      $or: [{ sender: user._id }, { recipient: user._id }],
      status: 'pending',
    }).lean();

    const pendingUserIds = pendingRequests.map((reqDoc) =>
      reqDoc.sender.toString() === user._id.toString()
        ? reqDoc.recipient.toString()
        : reqDoc.sender.toString()
    );

    // List of IDs to exclude (self, existing friends, pending requests)
    const excludeIds = [
      user._id.toString(),
      ...user.friends.map((fId) => fId.toString()),
      ...pendingUserIds,
    ];

    // Escape query parameters to prevent regex injection attacks
    const escapedQuery = queryStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const searchRegex = new RegExp(escapedQuery, 'i');

    const searchCriteria = {
      _id: { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)) },
      $or: [
        { email: searchRegex },
        { firstName: searchRegex },
        { lastName: searchRegex },
      ],
    };

    // Return only public display fields (names & ID), omitting email address to minimize PII
    const matchedUsers = await User.find(searchCriteria)
      .select('firstName lastName')
      .skip(skip)
      .limit(limit)
      .lean();

    const totalCount = await User.countDocuments(searchCriteria);

    res.status(200).json({
      success: true,
      data: {
        users: matchedUsers,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Send a friend request.
 */
export const sendFriendRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { recipientId } = req.body;

    if (!recipientId || !isValidObjectId(recipientId)) {
      throw new AppError('A valid recipient ID is required.', 400);
    }

    if (user._id.toString() === recipientId.toString()) {
      throw new AppError('You cannot send a friend request to yourself.', 400);
    }

    const recipientUser = await User.findById(recipientId);
    if (!recipientUser) {
      throw new AppError('Recipient user not found.', 404);
    }

    // Check if they are already friends
    const isAlreadyFriend = user.friends.some(
      (friendId) => friendId.toString() === recipientId.toString()
    );
    if (isAlreadyFriend) {
      throw new AppError('You are already friends with this user.', 400);
    }

    // Check if an outgoing or incoming pending request exists
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { sender: user._id, recipient: recipientId },
        { sender: recipientId, recipient: user._id },
      ],
    });

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        if (existingRequest.sender.toString() === user._id.toString()) {
          throw new AppError('You have already sent a pending request to this user.', 400);
        } else {
          throw new AppError(
            'This user has already sent you a friend request. Please respond to it.',
            400
          );
        }
      }

      // If the request was previously rejected, reset it to pending
      if (existingRequest.status === 'rejected') {
        existingRequest.sender = user._id as any;
        existingRequest.recipient = recipientId as any;
        existingRequest.status = 'pending';
        await existingRequest.save();

        auditLog.friendRequestCreated(user.email, recipientId);
        res.status(200).json({
          success: true,
          message: 'Friend request sent.',
          data: { request: existingRequest },
        });
        return;
      }
      
      if (existingRequest.status === 'accepted') {
        throw new AppError('You are already friends with this user.', 400);
      }
    }

    // Create new friend request
    const request = await FriendRequest.create({
      sender: user._id,
      recipient: recipientId,
      status: 'pending',
    });

    auditLog.friendRequestCreated(user.email, recipientId);

    res.status(201).json({
      success: true,
      message: 'Friend request sent successfully.',
      data: { request },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all pending requests (both incoming and outgoing).
 */
export const getPendingRequests = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const requests = await FriendRequest.find({
      $or: [{ sender: user._id }, { recipient: user._id }],
      status: 'pending',
    })
      .populate('sender', 'firstName lastName email')
      .populate('recipient', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: { requests },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Accept or reject a friend request.
 */
export const respondToRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { id: requestId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    if (!requestId || !isValidObjectId(requestId)) {
      throw new AppError('A valid request ID is required.', 400);
    }

    if (action !== 'accept' && action !== 'reject') {
      throw new AppError('Action must be either "accept" or "reject".', 400);
    }

    const request = await FriendRequest.findById(requestId);
    if (!request) {
      throw new AppError('Friend request not found.', 404);
    }

    // Security check: Only the recipient can accept or reject the request
    if (request.recipient.toString() !== user._id.toString()) {
      auditLog.authorizationFailure(user.email, 'respondToRequest', requestId);
      throw new AppError('You are not authorized to respond to this request.', 403);
    }

    if (request.status !== 'pending') {
      throw new AppError('This request has already been processed.', 400);
    }

    if (action === 'accept') {
      // Atomic updates to ensure bidirectional friendship without duplicates
      await User.updateOne(
        { _id: request.sender },
        { $addToSet: { friends: request.recipient } }
      );
      await User.updateOne(
        { _id: request.recipient },
        { $addToSet: { friends: request.sender } }
      );

      request.status = 'accepted';
      await request.save();

      auditLog.friendRequestResponded(requestId, user.email, 'accept');

      res.status(200).json({
        success: true,
        message: 'Friend request accepted.',
        data: { request },
      });
    } else {
      request.status = 'rejected';
      await request.save();

      auditLog.friendRequestResponded(requestId, user.email, 'reject');

      res.status(200).json({
        success: true,
        message: 'Friend request rejected.',
        data: { request },
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user's friends list.
 */
export const getFriendsList = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    // Fetch the user object and populate the friends field
    const userWithFriends = await User.findById(user._id)
      .populate('friends', 'firstName lastName email')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        friends: userWithFriends ? userWithFriends.friends : [],
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Remove a friend.
 */
export const removeFriend = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { friendId } = req.body;

    if (!friendId || !isValidObjectId(friendId)) {
      throw new AppError('A valid friend ID is required.', 400);
    }

    // Atomic pull updates on both users
    await User.updateOne(
      { _id: user._id },
      { $pull: { friends: friendId } }
    );
    await User.updateOne(
      { _id: friendId },
      { $pull: { friends: user._id } }
    );

    // Clean up or mark corresponding FriendRequest as rejected/deleted to allow future request
    await FriendRequest.deleteOne({
      $or: [
        { sender: user._id, recipient: friendId },
        { sender: friendId, recipient: user._id },
      ],
    });

    auditLog.friendRequestResponded('N/A', user.email, 'reject'); // audit removal

    res.status(200).json({
      success: true,
      message: 'Friend removed successfully.',
    });
  } catch (error) {
    next(error);
  }
};
