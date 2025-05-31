import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { JwtPayload } from 'jsonwebtoken';
import { User } from 'prisma/app/generated/prisma/client';
import { EmailService } from 'src/email/email.service';
import { UserSessionRepository } from 'src/user-session/user-session.repository';
import { BaseUserDto } from 'src/user/dtos/base-user.dto';
import { UserRepository } from 'src/user/user.repository';
import { ChangePasswordDto } from './dtos/change-password-user.schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userSessionRepository: UserSessionRepository,
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Generates a JWT access token for the given payload.
   *
   * @param {T} payload - The payload containing user information (id, name, email).
   *
   * @returns {{ token: string; expiresIn: string }} - An object containing the generated JWT token and its expiry time in minutes.
   *
   * @template T - A generic type that extends an object with id, name, and email properties.
   */
  generateAccessToken<T extends { id: string; name: string; email: string }>(
    payload: T,
  ): { token: string; expiresIn: string } {
    const token = this.jwtService.sign(
      { id: payload.id, name: payload.name, email: payload.email },
      { secret: process.env.JWT_SECRET_KEY, expiresIn: '15m' },
    );

    return { token, expiresIn: '15m' };
  }

  /**
   * Generates a new refresh token and its expiry date.
   *
   * @returns {{ token: string; expiresIn: Date }} - An object containing the generated refresh token
   * and its expiry date, which is set to 7 days from the current date.
   */
  generateRefreshToken(): { token: string; expiresIn: Date } {
    const token = randomUUID();

    const expiresIn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return { token, expiresIn };
  }

  /**
   * Creates a new user session by generating a refresh token and access token.
   *
   * @param {User} user - The user for whom the session is being created.
   * @param {string} userAgent - The user agent string from the request header.
   * @param {string} ip - The IP address from which the request originated.
   *
   * @returns {Object} - An object containing the generated access token, refresh token,
   * and the expiry time of the access token.
   */
  async createSession(
    user: Omit<BaseUserDto, 'password'>,
    userAgent: string,
    ip?: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: string }> {
    const { token: refreshToken, expiresIn } = this.generateRefreshToken();

    await this.userSessionRepository.create({
      userId: user.id!,
      refreshToken,
      userAgent,
      ipAddress: ip,
      expiresAt: expiresIn,
    });

    const access = this.generateAccessToken({
      id: user.id!,
      name: user.name,
      email: user.email,
    });

    return {
      accessToken: access.token,
      refreshToken,
      expiresIn: access.expiresIn,
    };
  }

  /**
   * Refreshes a user's session by generating a new access token and refresh token.
   * Verifies the provided refresh token and ensures it has not expired.
   *
   * @param {string} refreshToken - The refresh token to be refreshed.
   *
   * @returns {Object} - An object containing the new access token, refresh token,
   * and the expiry time of the access token.
   *
   * @throws {UnauthorizedException} - Thrown if the refresh token is invalid or expired.
   * @throws {UserNotFoundException} - Thrown if the user associated with the session does not exist.
   */
  async refreshSession(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: string }> {
    const session = await this.userSessionRepository.findUnique(refreshToken);

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.userRepository.findUnique(session.userId);
    if (!user) throw new NotFoundException('User not found');

    const newAccess = this.generateAccessToken(user);

    const { token: newRefreshToken, expiresIn } = this.generateRefreshToken();

    await this.userSessionRepository.updateRefreshToken(
      session.id,
      newRefreshToken,
      expiresIn,
    );

    return {
      accessToken: newAccess.token,
      refreshToken: newRefreshToken,
      expiresIn: newAccess.expiresIn,
    };
  }

  /**
   * Revokes a user's session by deleting the associated refresh token.
   *
   * @param {string} refreshToken - The refresh token to be revoked.
   *
   * @throws {UnauthorizedException} - Thrown if the refresh token is invalid.
   */
  async revokeSession(refreshToken: string) {
    await this.userSessionRepository.deleteByRefreshToken(refreshToken);
  }

  /**
   * Verifies a given JWT token and returns the payload if successful.
   * The payload is expected to be an object that extends the object type.
   * If the verification fails, an UnauthorizedException is thrown.
   *
   * @param token - The token to be verified.
   *
   * @returns {Promise<T>} - A promise that resolves to the payload of the token.
   *
   * @throws {UnauthorizedException} - Thrown if the token is invalid or expired.
   */
  async verifyToken<T extends object>(token: string): Promise<T> {
    console.log(token);
    try {
      return await this.jwtService.verifyAsync<T>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Decodes a JWT token and returns the payload if successful, or null if the decoding fails.
   *
   * @param token - The token to be decoded.
   *
   * @returns {JwtPayload | null} - The payload of the token, or null if decoding fails.
   */
  decodeToken(token: string): JwtPayload | null {
    try {
      return this.jwtService.decode(token);
    } catch {
      return null;
    }
  }

  /**
   * Sends a password reset email to the given email address if a User with that address exists.
   *
   * @param {string} email - The email address of the User to send the password reset email to.
   *
   * @returns {Promise<void>} - A promise that resolves when the password reset email has been sent.
   *
   * @throws {BadRequestException} - Thrown if the email address is missing or undefined.
   * @throws {NotFoundException} - Thrown if the User with the given email address does not exist in the database.
   * @throws {UnauthorizedException} - Thrown if the given email address is invalid.
   */
  async forgotPassword(email: string): Promise<string> {
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    const retrievedCustomer =
      await this.userRepository.findUniqueByEmail(email);

    if (!retrievedCustomer) {
      throw new NotFoundException('User not found');
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      retrievedCustomer.email != email
    ) {
      throw new UnauthorizedException('Invalid email format');
    }

    const { token } = this.generateAccessToken({
      id: retrievedCustomer.id,
      name: retrievedCustomer.name,
      email: retrievedCustomer.email,
    });

    await this.emailService.sendResetPasswordEmail(
      retrievedCustomer.email,
      retrievedCustomer.name,
      token,
    );

    return 'Password reset email sent successfully';
  }

  /**
   * Resets the password of a User in the database.
   *
   * @param {string} token - The token to verify the User.
   * @param {ChangePasswordDto} resetPasswordDto - Data transfer object containing the new password of the User.
   *
   * @returns {Promise<string>} - A promise that resolves to a string 'Password reset successfully' if the operation is successful.
   *
   * @throws {BadRequestException} - Thrown if the token or new password is missing or undefined.
   * @throws {NotFoundException} - Thrown if the User with the given token does not exist in the database.
   */
  async resetPassword(
    token: string,
    resetPasswordDto: ChangePasswordDto,
  ): Promise<string> {
    if (!token || !resetPasswordDto.newPassword) {
      throw new BadRequestException('Missing required properties');
    }

    const retrievedCustomer = await this.verifyToken<User>(token);

    if (!retrievedCustomer) {
      throw new NotFoundException('User not found');
    }

    const hashedNewPassword = await hash(resetPasswordDto.newPassword, 10);

    await this.userRepository.updatePassword(
      retrievedCustomer.id,
      hashedNewPassword,
    );

    return 'Password reset successfully';
  }
}
