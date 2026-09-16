import { eq, and, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import {
  isJoinedPlatformBrandId,
  isPlatformRefreshSpineEnabled,
  resolveMintAudienceBrand,
} from '../config/brand-capabilities';
import type { JoinedRuntimeBrandId } from '../config/platform-brands';
import { audienceForBrand } from '../config/platform-brands';
import * as schema from '../db/schema';
import type { Database, Env, AuthTokens, UserResponse } from '../types';
import { avatarKeyFor, avatarKeyFromStored, resolveAvatarUrl } from '../utils/avatar-url';
import { ConflictError, UnauthorizedError, NotFoundError } from '../utils/errors';
import { generateId, now, addTime, isExpired } from '../utils/id';
import { generateAccessToken, generateRefreshToken, getRefreshTokenExpiry } from '../utils/jwt';
import { hashPassword, verifyPassword, generateToken, hashToken } from '../utils/password';
import { normalizeUserRole } from '../utils/user-role';

import { assertPlatformRegistrationEnabled } from './bridge-control';
import { hardDeleteUser } from './account-hard-delete';
import { ensureAppEntitlement, upsertPlatformProfile } from './shared-user-service';


export class AuthService {
  private db: Database;
  private mintAudienceBrand: JoinedRuntimeBrandId | undefined;

  constructor(
    private env: Env,
    d1: D1Database
  ) {
    this.db = drizzle(d1, { schema });
  }

  /** House mints tokens for a child caller brand (trusted header + service token). */
  setMintAudienceBrand(brand: string | undefined): void {
    if (brand && isJoinedPlatformBrandId(brand)) {
      this.mintAudienceBrand = brand;
    } else {
      this.mintAudienceBrand = undefined;
    }
  }

  /**
   * Register a new user with email and password
   */
  async register(
    email: string,
    password: string,
    displayName?: string
  ): Promise<{ user: UserResponse; tokens: AuthTokens }> {
    await assertPlatformRegistrationEnabled(this.env);
    // Check if email already exists
    const existingUser = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()))
      .get();

    if (existingUser) {
      throw new ConflictError('An account with this email already exists');
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const userId = generateId();
    const timestamp = now();

    await this.db.insert(schema.users).values({
      id: userId,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      display_name: displayName || null,
      email_verified: false,
      created_at: timestamp,
      updated_at: timestamp,
    });

    // Generate tokens
    const tokens = await this.generateTokens(userId, email.toLowerCase(), false);

    // Create email verification token
    await this.createEmailVerification(userId);

    const user = await this.getUserById(userId);

    return { user: user!, tokens };
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<{ user: UserResponse; tokens: AuthTokens }> {
    const user = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.email, email.toLowerCase()),
          isNull(schema.users.deleted_at)
        )
      )
      .get();

    if (!user || !user.password_hash) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.email_verified);
    const userResponse = this.mapUserToResponse(user);

    return { user: userResponse, tokens };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = await hashToken(refreshToken);

    const storedToken = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.token_hash, tokenHash),
          isNull(schema.refreshTokens.revoked_at)
        )
      )
      .get();

    if (!storedToken || isExpired(storedToken.expires_at)) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Get user
    const user = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, storedToken.user_id),
          isNull(schema.users.deleted_at)
        )
      )
      .get();

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Revoke old refresh token (rotation)
    await this.db
      .update(schema.refreshTokens)
      .set({ revoked_at: now() })
      .where(eq(schema.refreshTokens.id, storedToken.id));

    // Generate new tokens
    return this.generateTokens(user.id, user.email, user.email_verified);
  }

  /**
   * Logout - revoke refresh token
   */
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = await hashToken(refreshToken);

    await this.db
      .update(schema.refreshTokens)
      .set({ revoked_at: now() })
      .where(eq(schema.refreshTokens.token_hash, tokenHash));
  }

  /**
   * Create email verification token
   */
  async createEmailVerification(userId: string): Promise<string> {
    const token = generateToken();
    const tokenHash = await hashToken(token);

    await this.db.insert(schema.emailVerifications).values({
      id: generateId(),
      user_id: userId,
      token_hash: tokenHash,
      expires_at: addTime(24 * 60 * 60), // 24 hours
      created_at: now(),
    });

    return token;
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<void> {
    const tokenHash = await hashToken(token);

    const verification = await this.db
      .select()
      .from(schema.emailVerifications)
      .where(
        and(
          eq(schema.emailVerifications.token_hash, tokenHash),
          isNull(schema.emailVerifications.verified_at)
        )
      )
      .get();

    if (!verification) {
      throw new NotFoundError('Verification token');
    }

    if (isExpired(verification.expires_at)) {
      throw new UnauthorizedError('Verification token has expired');
    }

    // Mark as verified
    await this.db
      .update(schema.emailVerifications)
      .set({ verified_at: now() })
      .where(eq(schema.emailVerifications.id, verification.id));

    // Update user
    await this.db
      .update(schema.users)
      .set({ email_verified: true, updated_at: now() })
      .where(eq(schema.users.id, verification.user_id));
  }

  /**
   * Create password reset token
   */
  async createPasswordReset(email: string): Promise<string | null> {
    const user = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.email, email.toLowerCase()),
          isNull(schema.users.deleted_at)
        )
      )
      .get();

    // Don't reveal if user exists
    if (!user) {
      return null;
    }

    const token = generateToken();
    const tokenHash = await hashToken(token);

    await this.db.insert(schema.passwordResets).values({
      id: generateId(),
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: addTime(60 * 60), // 1 hour
      created_at: now(),
    });

    return token;
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = await hashToken(token);

    const reset = await this.db
      .select()
      .from(schema.passwordResets)
      .where(
        and(
          eq(schema.passwordResets.token_hash, tokenHash),
          isNull(schema.passwordResets.used_at)
        )
      )
      .get();

    if (!reset) {
      throw new NotFoundError('Reset token');
    }

    if (isExpired(reset.expires_at)) {
      throw new UnauthorizedError('Reset token has expired');
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // Update password
    await this.db
      .update(schema.users)
      .set({ password_hash: passwordHash, updated_at: now() })
      .where(eq(schema.users.id, reset.user_id));

    // Mark reset as used
    await this.db
      .update(schema.passwordResets)
      .set({ used_at: now() })
      .where(eq(schema.passwordResets.id, reset.id));

    // Revoke all refresh tokens for this user
    await this.db
      .update(schema.refreshTokens)
      .set({ revoked_at: now() })
      .where(eq(schema.refreshTokens.user_id, reset.user_id));
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    if (!user || !user.password_hash) {
      throw new NotFoundError('User');
    }

    const isValid = await verifyPassword(currentPassword, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    const passwordHash = await hashPassword(newPassword);

    await this.db
      .update(schema.users)
      .set({ password_hash: passwordHash, updated_at: now() })
      .where(eq(schema.users.id, userId));
  }

  /**
   * Handle Apple Sign-In
   */
  async handleAppleAuth(
    appleId: string,
    email: string | undefined,
    emailVerified: boolean,
    firstName?: string,
    lastName?: string
  ): Promise<{ user: UserResponse; tokens: AuthTokens; isNewUser: boolean }> {
    // Check if user exists with this Apple ID
    let user = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.apple_id, appleId))
      .get();

    let isNewUser = false;

    if (!user && email) {
      // Check if user exists with this email
      user = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email.toLowerCase()))
        .get();

      if (user) {
        // Link Apple ID to existing account
        await this.db
          .update(schema.users)
          .set({
            apple_id: appleId,
            email_verified: user.email_verified || emailVerified,
            updated_at: now(),
          })
          .where(eq(schema.users.id, user.id));
      }
    }

    if (!user) {
      await assertPlatformRegistrationEnabled(this.env);
      // Create new user
      isNewUser = true;
      const userId = generateId();
      const timestamp = now();
      const displayName =
        firstName && lastName
          ? `${firstName} ${lastName}`.trim()
          : firstName || lastName || null;

      await this.db.insert(schema.users).values({
        id: userId,
        email: email?.toLowerCase() || `apple_${appleId}@privaterelay.appleid.com`,
        apple_id: appleId,
        email_verified: emailVerified,
        display_name: displayName,
        created_at: timestamp,
        updated_at: timestamp,
      });

      user = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get();
    }

    const tokens = await this.generateTokens(user!.id, user!.email, user!.email_verified);
    const userResponse = this.mapUserToResponse(user!);

    return { user: userResponse, tokens, isNewUser };
  }

  /**
   * Handle Google Sign-In
   */
  async handleGoogleAuth(
    googleId: string,
    email: string,
    emailVerified: boolean,
    name?: string,
    picture?: string
  ): Promise<{ user: UserResponse; tokens: AuthTokens; isNewUser: boolean }> {
    // Check if user exists with this Google ID
    let user = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.google_id, googleId))
      .get();

    let isNewUser = false;

    if (!user) {
      // Check if user exists with this email
      user = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email.toLowerCase()))
        .get();

      if (user) {
        // Link Google ID to existing account
        await this.db
          .update(schema.users)
          .set({
            google_id: googleId,
            email_verified: user.email_verified || emailVerified,
            avatar_url: user.avatar_url || picture,
            updated_at: now(),
          })
          .where(eq(schema.users.id, user.id));
      }
    }

    if (!user) {
      await assertPlatformRegistrationEnabled(this.env);
      // Create new user
      isNewUser = true;
      const userId = generateId();
      const timestamp = now();

      await this.db.insert(schema.users).values({
        id: userId,
        email: email.toLowerCase(),
        google_id: googleId,
        email_verified: emailVerified,
        display_name: name || null,
        avatar_url: picture || null,
        created_at: timestamp,
        updated_at: timestamp,
      });

      user = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get();
    }

    const tokens = await this.generateTokens(user!.id, user!.email, user!.email_verified);
    const userResponse = this.mapUserToResponse(user!);

    return { user: userResponse, tokens, isNewUser };
  }

  /**
   * HARD delete a user account: zero records remain.
   *
   * This used to stamp `users.deleted_at` and stop, which left every row the
   * person ever wrote in place behind a tombstone. The tombstone was not
   * harmless either — the sign-up uniqueness check does not exclude
   * soft-deleted rows, so a deleted account permanently blocked its own email:
   * observed on production 2026-09-04, where the same address answered `409
   * Conflict` on every retry while the credentials were already revoked. The
   * person could neither sign in nor sign up.
   *
   * `hardDeleteUser` owns the sweep and its ordering; see that module for why
   * the table list is derived from the schema rather than written by hand.
   * Detachment still runs — inside it — so a home with other members left keeps
   * its data and gains a promoted owner, and only homes left with nobody are
   * erased.
   *
   * Refresh tokens are not revoked separately any more: `refresh_tokens` is
   * user-scoped, so the sweep DELETES those rows outright, which is strictly
   * stronger than marking them revoked.
   */
  async deleteAccount(userId: string): Promise<void> {
    // The bucket is passed so the person's FILES go with their rows. Without
    // it the reports, floor plans and avatars survive as orphans that nothing
    // in the database names any more — undiscoverable by any later audit.
    await hardDeleteUser(this.db, userId, this.env.REPORTS_BUCKET);
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<UserResponse | null> {
    const user = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, userId),
          isNull(schema.users.deleted_at)
        )
      )
      .get();

    return user ? this.mapUserToResponse(user) : null;
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<UserResponse | null> {
    const user = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.email, email.toLowerCase()),
          isNull(schema.users.deleted_at)
        )
      )
      .get();

    return user ? this.mapUserToResponse(user) : null;
  }

  /**
   * Update user profile
   */
  async updateUser(
    userId: string,
    updates: { display_name?: string; avatar_url?: string | null }
  ): Promise<UserResponse> {
    const finalUpdates: { display_name?: string; avatar_url?: string | null; updated_at: string } = {
      updated_at: now(),
    };

    if (updates.display_name !== undefined) {
      finalUpdates.display_name = updates.display_name;
    }

    // Handle avatar upload to R2 if it's a base64 data URL
    if (updates.avatar_url !== undefined) {
      if (updates.avatar_url === null) {
        // Remove avatar - delete from R2 if exists
        const existingUser = await this.db
          .select({ avatar_url: schema.users.avatar_url })
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .get();

        // Matches a stored KEY as well as the legacy absolute URL — see
        // `avatarKeyFromStored`. Matching only the URL form would have leaked
        // one object per re-upload once writes became keys.
        const oldKey = avatarKeyFromStored(existingUser?.avatar_url);
        if (oldKey && this.env.REPORTS_BUCKET) {
          try {
            await this.env.REPORTS_BUCKET.delete(oldKey);
          } catch (error) {
            console.error('Failed to delete old avatar:', error);
          }
        }
        finalUpdates.avatar_url = null;
      } else if (updates.avatar_url.startsWith('data:image/')) {
        // Upload base64 to R2
        const avatarUrl = await this.uploadAvatarToR2(userId, updates.avatar_url);
        finalUpdates.avatar_url = avatarUrl;
      } else {
        // Already a URL — but reads hand the client a RESOLVED absolute URL,
        // and a profile save sends it straight back here. Storing it verbatim
        // re-froze this Worker's host into the row on every save, undoing the
        // key form within minutes of the migration and re-creating the
        // cross-app reference the moment two apps shared a profile.
        //
        // Normalize ours back down to a key; leave a provider picture
        // (Google/Apple) exactly as sent, since it is not ours to re-host.
        finalUpdates.avatar_url =
          avatarKeyFromStored(updates.avatar_url) ?? updates.avatar_url;
      }
    }

    await this.db
      .update(schema.users)
      .set(finalUpdates)
      .where(eq(schema.users.id, userId));

    const user = await this.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    return user;
  }

  /**
   * Upload avatar to R2 storage
   */
  private async uploadAvatarToR2(userId: string, base64Data: string): Promise<string> {
    if (!this.env.REPORTS_BUCKET) {
      // Fallback to storing base64 directly if R2 not available
      return base64Data;
    }

    // Parse base64 data URL
    const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image data');
    }

    const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const base64Content = matches[2];
    const binaryContent = Uint8Array.from(atob(base64Content), (c) => c.charCodeAt(0));

    // Generate unique filename
    const filename = `${userId}-${Date.now()}.${extension}`;
    const key = avatarKeyFor(filename);

    // Upload to R2
    await this.env.REPORTS_BUCKET.put(key, binaryContent, {
      httpMetadata: {
        contentType: `image/${extension}`,
      },
    });

    // The KEY, not a URL. Storing `${API_URL}/avatars/…` froze this Worker's
    // hostname into a row that outlives it — and these rows were cloned across
    // apps, which is how Budget, Kaizen and Health ended up serving avatars off
    // House. `resolveAvatarUrl` builds the address at read time instead, so an
    // app always serves its own bucket. See utils/avatar-url.ts.
    return key;
  }

  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(
    userId: string,
    email: string,
    emailVerified: boolean
  ): Promise<AuthTokens> {
    const sid = crypto.randomUUID();
    const accessToken = await generateAccessToken(
      { sub: userId, email, email_verified: emailVerified, sid, ent_ver: 1 },
      this.env,
      { audienceBrand: resolveMintAudienceBrand(this.mintAudienceBrand) }
    );

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = await hashToken(refreshToken);
    const expiresAt = getRefreshTokenExpiry(this.env);

    // Store refresh token (legacy table — keeps existing mobile refresh flow)
    await this.db.insert(schema.refreshTokens).values({
      id: generateId(),
      user_id: userId,
      token_hash: refreshTokenHash,
      expires_at: expiresAt.toISOString(),
      created_at: now(),
    });

    // Platform refresh spine (sid-scoped revocation)
    if (isPlatformRefreshSpineEnabled(this.env)) {
      try {
        const brand = resolveMintAudienceBrand(this.mintAudienceBrand);
        await this.db.insert(schema.platformRefreshTokens).values({
          id: generateId(),
          user_id: userId,
          token_hash: refreshTokenHash,
          sid,
          client_id: audienceForBrand(brand),
          ent_ver: 1,
          expires_at: expiresAt.toISOString(),
          created_at: now(),
        });
      } catch (err) {
        console.warn('[auth] platform_refresh_tokens insert skipped', (err as Error).message);
      }
    }

    // Best-effort platform rows on House when minting joined tokens.
    if (isPlatformRefreshSpineEnabled(this.env)) {
      const brand = resolveMintAudienceBrand(this.mintAudienceBrand);
      try {
        await ensureAppEntitlement(this.env, userId, brand);
        await upsertPlatformProfile(this.env, userId, {
          contact_email: email,
          contact_email_verified: emailVerified,
        });
      } catch (err) {
        console.warn('[auth] platform profile/entitlement upsert failed', (err as Error).message);
      }
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: parseInt(this.env.ACCESS_TOKEN_EXPIRY, 10) || 900,
    };
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<
    Array<{
      id: string;
      device_info: { platform?: string; os_version?: string; app_version?: string } | null;
      created_at: string;
      expires_at: string;
      is_current: boolean;
    }>
  > {
    const tokens = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.user_id, userId),
          isNull(schema.refreshTokens.revoked_at)
        )
      )
      .all();

    return tokens
      .filter((t) => !isExpired(t.expires_at))
      .map((t) => ({
        id: t.id,
        device_info: t.device_info ? JSON.parse(t.device_info) : null,
        created_at: t.created_at,
        expires_at: t.expires_at,
        is_current: false,
      }));
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revoked_at: now() })
      .where(
        and(
          eq(schema.refreshTokens.id, sessionId),
          eq(schema.refreshTokens.user_id, userId)
        )
      );
  }

  /**
   * Revoke all sessions except current
   */
  async revokeAllSessionsExceptCurrent(
    userId: string,
    _currentAccessToken?: string
  ): Promise<void> {
    // Revoke all active sessions for this user
    await this.db
      .update(schema.refreshTokens)
      .set({ revoked_at: now() })
      .where(
        and(
          eq(schema.refreshTokens.user_id, userId),
          isNull(schema.refreshTokens.revoked_at)
        )
      );
  }

  /**
   * Accept terms of service
   */
  async acceptTerms(userId: string): Promise<UserResponse> {
    const timestamp = now();

    await this.db
      .update(schema.users)
      .set({ terms_accepted_at: timestamp, updated_at: timestamp })
      .where(eq(schema.users.id, userId));

    const user = await this.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    return user;
  }

  /**
   * Map database user to API response
   */
  /**
   * Update user onboarding progress
   */
  async updateOnboardingProgress(
    userId: string,
    step: 'household' | 'report' | 'garbage' | 'floor_plan' | 'complete'
  ): Promise<UserResponse> {
    const updates: Partial<schema.User> = {
      updated_at: now(),
    };

    switch (step) {
      case 'household':
        updates.onboarding_household_created = true;
        break;
      case 'report':
        updates.onboarding_report_added = true;
        break;
      case 'garbage':
        updates.onboarding_garbage_setup = true;
        break;
      case 'floor_plan':
        updates.onboarding_floor_plan_added = true;
        break;
      case 'complete':
        updates.has_completed_onboarding = true;
        break;
    }

    await this.db
      .update(schema.users)
      .set(updates)
      .where(eq(schema.users.id, userId))
      .run();

    const user = await this.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  /**
   * Get user onboarding status
   */
  async getOnboardingStatus(userId: string): Promise<{
    has_completed_onboarding: boolean;
    onboarding_household_created: boolean;
    onboarding_report_added: boolean;
    onboarding_garbage_setup: boolean;
    onboarding_floor_plan_added: boolean;
  }> {
    const user = await this.db
      .select({
        has_completed_onboarding: schema.users.has_completed_onboarding,
        onboarding_household_created: schema.users.onboarding_household_created,
        onboarding_report_added: schema.users.onboarding_report_added,
        onboarding_garbage_setup: schema.users.onboarding_garbage_setup,
        onboarding_floor_plan_added: schema.users.onboarding_floor_plan_added,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return {
      has_completed_onboarding: Boolean(user.has_completed_onboarding),
      onboarding_household_created: Boolean(user.onboarding_household_created),
      onboarding_report_added: Boolean(user.onboarding_report_added),
      onboarding_garbage_setup: Boolean(user.onboarding_garbage_setup),
      onboarding_floor_plan_added: Boolean(user.onboarding_floor_plan_added),
    };
  }

  private mapUserToResponse(user: schema.User): UserResponse {
    return {
      id: user.id,
      email: user.email,
      email_verified: user.email_verified,
      display_name: user.display_name,
      avatar_url: resolveAvatarUrl(user.avatar_url, this.env.API_URL),
      has_password: !!user.password_hash,
      has_apple: !!user.apple_id,
      has_google: !!user.google_id,
      role: normalizeUserRole(user.role),
      terms_accepted_at: user.terms_accepted_at,
      has_completed_onboarding: Boolean(user.has_completed_onboarding),
      onboarding_household_created: Boolean(user.onboarding_household_created),
      onboarding_report_added: Boolean(user.onboarding_report_added),
      onboarding_garbage_setup: Boolean(user.onboarding_garbage_setup),
      onboarding_floor_plan_added: Boolean(user.onboarding_floor_plan_added),
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
}
