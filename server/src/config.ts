import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Validate JWT secret security
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

  // In production, JWT_SECRET is mandatory
  if (isProduction && !secret) {
    throw new Error(
      'JWT_SECRET environment variable is required in production. ' +
      'Generate a secure secret with: openssl rand -base64 64'
    );
  }

  // In development, allow fallback but warn
  if (isDevelopment && !secret) {
    console.warn(
      '⚠️  WARNING: Using default JWT secret for development. ' +
      'Set JWT_SECRET environment variable for security.'
    );
    return 'viridian-dev-secret-change-in-production';
  }

  // Validate secret length (minimum 32 characters for security)
  if (secret && secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters long for security. ' +
      'Current length: ' + secret.length
    );
  }

  return secret!;
}

function getPort(): number {
  const parsed = parseInt(process.env.PORT || '3010', 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(`Invalid PORT "${process.env.PORT}", falling back to 3010`);
    return 3010;
  }
  return parsed;
}

export const config = {
  host: process.env.HOST || 'localhost',
  port: getPort(),
  jwtSecret: getJwtSecret(),
  dbPath: resolve(__dirname, '..', 'data', 'auth.db'),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5174',
};
