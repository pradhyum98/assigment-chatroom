import { UserPublic } from '../types';

/**
 * Standard utility to transform Mongoose user documents into clean
 * API-ready responses, stripping sensitive fields.
 */
export const mapUserResponse = (user: any): UserPublic => {
  return {
    _id: user._id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    createdAt: user.createdAt,
  };
};
