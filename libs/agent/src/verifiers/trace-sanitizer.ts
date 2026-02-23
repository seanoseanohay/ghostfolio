import { createHash } from 'node:crypto';

function hashId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function bucketDollarValue(value: number): string {
  const abs = Math.abs(value);
  if (abs < 100) return '<$100';
  if (abs < 1000) return '$100-$999';
  if (abs < 10000) return '$1k-$9,999';
  if (abs < 100000) return '$10k-$99,999';
  return '$100k+';
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (key === 'userId' || key === 'user_id') {
    return typeof value === 'string' ? `hash:${hashId(value)}` : '[redacted]';
  }

  if (key === 'accountId' || key === 'account_id') {
    return typeof value === 'string' ? `hash:${hashId(value)}` : '[redacted]';
  }

  const dollarKeys = [
    'value',
    'amount',
    'totalReturn',
    'ytdReturn',
    'netPerformance',
    'totalInvestment',
    'currentValueInBaseCurrency',
    'estimatedLiability'
  ];

  if (dollarKeys.includes(key) && typeof value === 'number') {
    return bucketDollarValue(value);
  }

  return value;
}

export function traceSanitizer(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') return data;
  if (typeof data === 'number') return data;
  if (typeof data === 'boolean') return data;

  if (Array.isArray(data)) {
    return data.map((item) => traceSanitizer(item));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(
      data as Record<string, unknown>
    )) {
      result[key] = sanitizeValue(key, traceSanitizer(value));
    }

    return result;
  }

  return data;
}
