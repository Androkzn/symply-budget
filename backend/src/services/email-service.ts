import type { Env } from '../types';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  private apiKey: string;
  private fromEmail: string;
  private appUrl: string;

  constructor(env: Env) {
    this.apiKey = env.RESEND_API_KEY;
    this.fromEmail = 'Simple House <noreply@simplehouse.app>';
    this.appUrl = env.APP_URL;
  }

  /**
   * Send an email using Resend
   */
  async send(options: EmailOptions): Promise<boolean> {
    if (!this.apiKey) {
      console.log('Email service not configured, skipping email:', options.subject);
      return false;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Failed to send email:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  /**
   * Send email verification email
   */
  async sendVerificationEmail(email: string, token: string): Promise<boolean> {
    const verifyUrl = `${this.appUrl}/verify-email?token=${token}`;

    return this.send({
      to: email,
      subject: 'Verify your Simple House email',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .button { display: inline-block; background-color: #007AFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
              .footer { margin-top: 40px; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Welcome to Simple House!</h1>
              <p>Thanks for signing up. Please verify your email address to get started.</p>
              <a href="${verifyUrl}" class="button">Verify Email Address</a>
              <p>Or copy and paste this link into your browser:</p>
              <p><a href="${verifyUrl}">${verifyUrl}</a></p>
              <p>This link will expire in 24 hours.</p>
              <div class="footer">
                <p>If you didn't create an account with Simple House, you can safely ignore this email.</p>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `Welcome to Simple House! Please verify your email by visiting: ${verifyUrl}`,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
    const resetUrl = `${this.appUrl}/reset-password?token=${token}`;

    return this.send({
      to: email,
      subject: 'Reset your Simple House password',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .button { display: inline-block; background-color: #007AFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
              .footer { margin-top: 40px; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Reset Your Password</h1>
              <p>We received a request to reset your Simple House password.</p>
              <a href="${resetUrl}" class="button">Reset Password</a>
              <p>Or copy and paste this link into your browser:</p>
              <p><a href="${resetUrl}">${resetUrl}</a></p>
              <p>This link will expire in 1 hour.</p>
              <div class="footer">
                <p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `Reset your Simple House password by visiting: ${resetUrl}`,
    });
  }

  /**
   * Send household invitation email
   */
  async sendHouseholdInvitation(
    email: string,
    token: string,
    householdName: string,
    inviterName: string
  ): Promise<boolean> {
    const inviteUrl = `${this.appUrl}/invite/${token}`;

    return this.send({
      to: email,
      subject: `Join ${householdName} on Simple House`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .button { display: inline-block; background-color: #007AFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
              .footer { margin-top: 40px; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>You've Been Invited!</h1>
              <p><strong>${inviterName}</strong> has invited you to join <strong>${householdName}</strong> on Simple House.</p>
              <p>Simple House helps you manage your home by turning inspection reports into actionable maintenance plans.</p>
              <a href="${inviteUrl}" class="button">Accept Invitation</a>
              <p>Or copy and paste this link into your browser:</p>
              <p><a href="${inviteUrl}">${inviteUrl}</a></p>
              <p>This invitation will expire in 7 days.</p>
              <div class="footer">
                <p>If you don't want to join this household, you can safely ignore this email.</p>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `${inviterName} has invited you to join ${householdName} on Simple House. Accept the invitation: ${inviteUrl}`,
    });
  }
}
