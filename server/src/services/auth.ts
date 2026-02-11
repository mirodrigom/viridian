import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database.js';
import { config } from '../config.js';

const SALT_ROUNDS = 10;

interface User {
  id: number;
  username: string;
  password_hash: string;
}

export async function createUser(username: string, password: string): Promise<{ id: number; username: string }> {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    throw new Error('Username already exists');
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  return { id: result.lastInsertRowid as number, username };
}

export async function authenticateUser(username: string, password: string): Promise<string> {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
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

export function getUserCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return row.count;
}
