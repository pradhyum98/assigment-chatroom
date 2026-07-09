import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface UserDoc extends Document {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  friends: mongoose.Types.ObjectId[];

  // Presence
  lastSeen: Date;
  isOnline: boolean;

  // Crypto (E2EE)
  publicKey?: string;
  identityVersion?: number;
  encryptedPrivateKey?: {
    ciphertext: string;
    iv: string;
  };
  encryptedPasswordRecovery?: {
    ciphertext: string;
    iv: string;
    authTag: string;
    version: number;
  };

  // Profile (Phase 9)
  avatar?: string;
  bio?: string;
  statusMessage?: string;

  // Privacy settings (Phase 9)
  privacyLastSeen: 'everyone' | 'friends' | 'nobody';
  privacyOnlineStatus: 'everyone' | 'friends' | 'nobody';

  // Password reset fields
  passwordResetToken?: string;
  passwordResetExpires?: Date;

  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<UserDoc>(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      minlength: [2, 'First name must be at least 2 characters'],
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      minlength: [2, 'Last name must be at least 2 characters'],
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    friends: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    // ── Presence ───────────────────────────────────────────────────────────────
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },

    // ── Crypto ─────────────────────────────────────────────────────────────────
    publicKey: {
      type: String,
      default: undefined,
    },
    identityVersion: {
      type: Number,
      default: 1,
    },
    encryptedPrivateKey: {
      type: {
        ciphertext: String,
        iv: String,
      },
      default: undefined,
    },
    encryptedPasswordRecovery: {
      type: {
        ciphertext: String,
        iv: String,
        authTag: String,
        version: Number,
      },
      default: undefined,
      select: false, // Ensure this isn't accidentally queried
    },

    // ── Profile ────────────────────────────────────────────────────────────────
    avatar: {
      type: String,
      default: undefined,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: [200, 'Bio cannot exceed 200 characters'],
      default: undefined,
    },
    statusMessage: {
      type: String,
      trim: true,
      maxlength: [100, 'Status message cannot exceed 100 characters'],
      default: undefined,
    },

    // ── Privacy settings ───────────────────────────────────────────────────────
    privacyLastSeen: {
      type: String,
      enum: ['everyone', 'friends', 'nobody'],
      default: 'friends',
    },
    privacyOnlineStatus: {
      type: String,
      enum: ['everyone', 'friends', 'nobody'],
      default: 'friends',
    },
    passwordResetToken: {
      type: String,
      default: undefined,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      default: undefined,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare passwords
UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<UserDoc>('User', UserSchema);
