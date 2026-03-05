import type { useChatStore } from '@/stores/chat';

type ChatStore = ReturnType<typeof useChatStore>;

/** Parse a reset time string like "Feb 13, 12pm" into a timestamp. */
function parseResetTime(timeStr: string): number | null {
  try {
    // Normalize: "Feb 13, 12pm" or "Feb 13 3:30pm"
    const cleaned = timeStr.replace(',', '').trim();
    const match = cleaned.match(/^(\w+)\s+(\d{1,2})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!match) return null;

    const [, monthStr, dayStr, hourStr, minStr, ampm] = match;
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[monthStr!.toLowerCase().slice(0, 3)];
    if (month === undefined) return null;

    let hour = parseInt(hourStr!, 10);
    const minute = minStr ? parseInt(minStr, 10) : 0;
    if (ampm!.toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (ampm!.toLowerCase() === 'am' && hour === 12) hour = 0;

    const now = new Date();
    const resetDate = new Date(now.getFullYear(), month, parseInt(dayStr!, 10), hour, minute, 0, 0);

    // If the parsed date is in the past, it might be next year
    if (resetDate.getTime() < Date.now()) {
      resetDate.setFullYear(resetDate.getFullYear() + 1);
    }

    return resetDate.getTime();
  } catch {
    return null;
  }
}

/** Parse a time-only reset string like "10pm" or "3:30am" into a timestamp (today or tomorrow). */
function parseResetTimeOnly(timeStr: string): number | null {
  try {
    const cleaned = timeStr.trim();
    const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!match) return null;

    let hour = parseInt(match[1]!, 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    if (match[3]!.toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (match[3]!.toLowerCase() === 'am' && hour === 12) hour = 0;

    const now = new Date();
    const resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);

    // If the time is in the past today, it means tomorrow
    if (resetDate.getTime() < Date.now()) {
      resetDate.setDate(resetDate.getDate() + 1);
    }

    return resetDate.getTime();
  } catch {
    return null;
  }
}

/**
 * Rate limit detection from assistant messages and error text.
 * Parses reset times and sets the rate-limited-until timestamp on the chat store.
 */
export function useRateLimitDetector(chat: ChatStore) {
  /** Detect rate limit from any text (assistant message content or error). */
  function detectRateLimit(text: string) {
    // Match "resets Feb 13, 12pm" or "resets 10pm" (with optional timezone)
    const rateLimitWithDateMatch = text.match(/resets?\s+(\w+\s+\d{1,2},?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    const rateLimitTimeOnlyMatch = !rateLimitWithDateMatch && text.match(/resets?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    const isRateLimit = rateLimitWithDateMatch || rateLimitTimeOnlyMatch || /rate.?limit|hit.?(?:your|the)?.?limit|you.?ve hit|usage.?limit|quota|too many requests|429|overloaded/i.test(text);

    if (!isRateLimit) return;

    const resetTime = rateLimitWithDateMatch
      ? parseResetTime(rateLimitWithDateMatch[1]!)
      : rateLimitTimeOnlyMatch
        ? parseResetTimeOnly(rateLimitTimeOnlyMatch[1]!)
        : null;

    if (resetTime) {
      chat.setRateLimitedUntil(resetTime);
    } else {
      // Fallback: block for 5 minutes if we can't parse the time
      chat.setRateLimitedUntil(Date.now() + 5 * 60 * 1000);
    }
  }

  return { detectRateLimit };
}
