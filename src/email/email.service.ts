import { Injectable } from '@nestjs/common';
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export class MailService {
  static async send(msg: sgMail.MailDataRequired) {
    await sgMail.send(msg);
  }
}

@Injectable()
export class EmailService {
  /**
   * Sends a password reset email to the given email address.
   *
   * @param {string} email - The email address of the User to send the password reset email to.
   * @param {string} name - The name of the User to send the password reset email to.
   * @param {string} token - The token to verify the User.
   *
   * @returns {Promise<void>} - A promise that resolves when the password reset email has been sent.
   */
  async sendResetPasswordEmail(
    email: string,
    name: string,
    token: string,
  ): Promise<void> {
    const resetLink = `http://localhost:3000/reset-password?token=${token}`;

    const msg = {
      to: email,
      from: '',
      subject: 'Reset Password',
      html: `
            <p>Hello ${name},</p>
            <p>You have requested to reset your password.</p>
            <br />
            <p>Please click the link below to reset your password:</p>
            <p><a href="${resetLink}">Reset Password</a></p>
            <br />
            <p>This link will expire in 1 hour.</p>
            <br />
            <p>If you did not request this, please ignore this email.</p>
        `,
    };

    await MailService.send(msg);
  }
}
