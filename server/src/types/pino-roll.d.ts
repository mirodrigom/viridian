declare module 'pino-roll' {
  import type { DestinationStream } from 'pino';

  interface RollOptions {
    file: string;
    frequency?: 'daily' | 'hourly' | number;
    limit?: { count?: number };
    dateFormat?: string;
    extension?: string;
    symlink?: boolean;
    mkdir?: boolean;
  }

  export function roll(options: RollOptions): Promise<DestinationStream>;
}
