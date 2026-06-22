import { UserPublic } from '../types';

/**
 * Standard utility to transform Mongoose user documents into clean
 * API-ready responses, stripping sensitive fields (password, __v, etc.)
 * while including all new Phase-1 presence and profile fields.
 */
export const mapUserResponse = (user: any): UserPublic => {
  return {
    _id:           user._id.toString(),
    firstName:     user.firstName,
    lastName:      user.lastName,
    email:         user.email,
    friends:       user.friends ? user.friends.map((f: any) => f.toString()) : [],

    // Presence
    lastSeen:      user.lastSeen,
    isOnline:      user.isOnline ?? false,

    // Crypto
    publicKey:     user.publicKey,
    encryptedPrivateKey: user.encryptedPrivateKey,

    // Profile
    avatar:        user.avatar,
    bio:           user.bio,
    statusMessage: user.statusMessage,

    createdAt:     user.createdAt,
  };
};
