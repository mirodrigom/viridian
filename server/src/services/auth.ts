import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db, seedDefaultServicesForNewUser } from '../db/database.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('auth');

const SALT_ROUNDS = 10;

interface User {
  id: number;
  username: string;
  password_hash: string;
}

export async function createUser(username: string, password: string): Promise<{ id: number; username: string }> {
  const existing = await db('users').where({ username }).first();
  if (existing) {
    throw new Error('Username already exists');
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const [userId] = await db('users').insert({ username, password_hash: hash });
  await seedDefaultServicesForNewUser(userId);
  log.info({ userId, username }, 'User created');
  return { id: userId, username };
}

export async function authenticateUser(username: string, password: string): Promise<string> {
  const user = await db('users').where({ username }).first() as User | undefined;
  if (!user) {
    throw new Error('Invalid credentials');
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new Error('Invalid credentials');
  }
  return generateToken(user);
}

function generateToken(user: User): string {
  return jwt.sign({ id: user.id, username: user.username }, config.jwtSecret, { expiresIn: '7d' });
}

export function verifyToken(token: string): { id: number; username: string } {
  return jwt.verify(token, config.jwtSecret) as { id: number; username: string };
}

export async function getUserCount(): Promise<number> {
  const row = await db('users').count('* as count').first() as { count: number | string };
  return Number(row.count);
}
