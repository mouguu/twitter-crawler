/**
 * Timezone-aware formatting helpers.
 * 提供统一的时区格式化工具，确保输出符合用户所在时区。
 */

const DEFAULT_TIMEZONE =
  process.env.TWITTER_CRAWLER_TIMEZONE ||
  process.env.TWITTER_CRAWLER_TZ ||
  process.env.TZ ||
  'UTC';

/**
 * 判断给定字符串是否为有效的 IANA 时区。
 * @param {string} timezone
 * @returns {boolean}
 */
function isValidTimezone(timezone) {
  try {
    if (!timezone) return false;
    // Intl 会在遇到非法时区时抛出异常
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 返回默认的时区配置。
 * @returns {string}
 */
function getDefaultTimezone() {
  return DEFAULT_TIMEZONE;
}

/**
 * 解析并返回有效的时区字符串，非法值会降级为默认时区。
 * @param {string} [timezone]
 * @returns {string}
 */
function resolveTimezone(timezone) {
  if (!timezone) {
    return DEFAULT_TIMEZONE;
  }
  const trimmed = String(timezone).trim();
  if (!trimmed) {
    return DEFAULT_TIMEZONE;
  }
  if (isValidTimezone(trimmed)) {
    return trimmed;
  }
  console.warn(`[time] Invalid timezone "${timezone}", falling back to ${DEFAULT_TIMEZONE}`);
  return DEFAULT_TIMEZONE;
}

/**
 * 将 "GMT+9:30" 等偏移量转换为 "+09:30" 形式。
 * @param {string} rawOffset
 * @returns {string}
 */
function normalizeOffset(rawOffset) {
  if (!rawOffset) {
    return '+00:00';
  }

  let offset = rawOffset.replace(/^(GMT|UTC)/, '');
  if (!offset) {
    return '+00:00';
  }

  if (!/^[+-]/.test(offset)) {
    offset = `+${offset}`;
  }

  if (!offset.includes(':')) {
    const sign = offset.startsWith('-') ? '-' : '+';
    const hours = offset.replace(/^[+-]/, '').padStart(2, '0');
    return `${sign}${hours}:00`;
  }

  const [hourPart, minutePart = '00'] = offset.split(':');
  const sign = hourPart.startsWith('-') ? '-' : '+';
  const hours = hourPart.replace(/^[+-]/, '').padStart(2, '0');
  const minutes = minutePart.padStart(2, '0');

  return `${sign}${hours}:${minutes}`;
}

/**
 * 按时区格式化日期，返回 ISO 字符串以及适合文件名的版本。
 * @param {Date|string|number} dateInput
 * @param {string} [timezone]
 * @param {Object} [options]
 * @param {boolean} [options.includeMilliseconds=true]
 * @param {boolean} [options.includeOffset=true]
 * @returns {{ iso: string, fileSafe: string, offset: string, parts: Record<string,string> }}
 */
function formatZonedTimestamp(dateInput, timezone, options = {}) {
  const date =
    dateInput instanceof Date ? dateInput : new Date(dateInput ?? Date.now());

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('formatZonedTimestamp: Invalid date input');
  }

  const tz = resolveTimezone(timezone);
  const {
    includeMilliseconds = true,
    includeOffset = true
  } = options;

  const baseFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const parts = baseFormatter.formatToParts(date);
  const partMap = {};
  parts.forEach(({ type, value }) => {
    if (type !== 'literal') {
      partMap[type] = value;
    }
  });

  const millis = includeMilliseconds
    ? String(date.getMilliseconds()).padStart(3, '0')
    : null;

  let iso = `${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}:${partMap.second}`;
  if (includeMilliseconds) {
    iso += `.${millis}`;
  }

  let offset = '+00:00';
  if (includeOffset) {
    const offsetFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      timeZoneName: 'shortOffset'
    });
    const offsetParts = offsetFormatter.formatToParts(date);
    const tzName = offsetParts.find(part => part.type === 'timeZoneName');
    if (tzName?.value) {
      offset = normalizeOffset(tzName.value);
    }
    iso += offset;
  }

  const fileSafe = iso
    .replace(/:/g, '-')
    .replace(/\./g, '-');

  return {
    iso,
    fileSafe,
    offset,
    parts: partMap
  };
}

/**
 * 生成易读的本地时间字符串，例如 "2025-10-21 13:19:52 (-04:00)"。
 * @param {Date|string|number} dateInput
 * @param {string} [timezone]
 * @returns {string}
 */
function formatReadableLocal(dateInput, timezone) {
  const { iso, offset } = formatZonedTimestamp(dateInput, timezone, {
    includeMilliseconds: false,
    includeOffset: true
  });
  const base = iso.endsWith(offset) ? iso.slice(0, iso.length - offset.length) : iso;
  return `${base.replace('T', ' ')} (${offset})`;
}

module.exports = {
  getDefaultTimezone,
  resolveTimezone,
  formatZonedTimestamp,
  formatReadableLocal
};
