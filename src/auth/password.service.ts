import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const value = this.requirePassword(password);
    return argon2.hash(value);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    const storedHash = hash.trim();
    const candidate = this.requirePassword(password);
    if (!storedHash) {
      throw new Error('Password hash is required');
    }
    return argon2.verify(storedHash, candidate);
  }

  private requirePassword(password: string): string {
    if (typeof password !== 'string' || password.length < 1) {
      throw new Error('Password is required');
    }
    return password;
  }
}
