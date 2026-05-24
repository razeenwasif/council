export type QueryValue = string | string[];

/**
 * Decodes a percent-encoded string, substituting '+' with space beforehand.
 * Gracefully falls back to the space-substituted raw string on URIError.
 */
function safeDecode(str: string): string {
  const withSpaces = str.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(withSpaces);
  } catch {
    return withSpaces;
  }
}

/**
 * Parses a URL-encoded query string into an object.
 * Replaces '+' with spaces, decodes percent-escapes, folds repeated keys into arrays,
 * and guards against prototype pollution.
 */
export function parseQueryString(input: string): Record<string, QueryValue> {
  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string');
  }

  const result: Record<string, QueryValue> = Object.create(null);

  let normalized = input;
  if (normalized.startsWith('?') || normalized.startsWith('#')) {
    normalized = normalized.slice(1);
  }

  if (!normalized) {
    return result;
  }

  const segments = normalized.split('&');

  for (const segment of segments) {
    if (!segment) {
      continue;
    }

    const equalIndex = segment.indexOf('=');
    let rawKey: string;
    let rawValue: string;

    if (equalIndex === -1) {
      rawKey = segment;
      rawValue = '';
    } else {
      rawKey = segment.slice(0, equalIndex);
      rawValue = segment.slice(equalIndex + 1);
    }

    const key = safeDecode(rawKey);
    const value = safeDecode(rawValue);

    // Prototype pollution guard (on DECODED key, so encoded variants are also blocked)
    if (/^(?:__proto__|constructor|prototype)(?:$|[^A-Za-z0-9_])/.test(key)) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(result, key)) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}
