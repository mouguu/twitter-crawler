/**
 * 验证工具模块
 * 提供输入验证、Cookie 验证等功能
 */

interface ValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

/**
 * 验证 Twitter 用户名格式
 */
export function validateTwitterUsername(username: any): ValidationResult {
  if (!username) {
    return { valid: false, error: '用户名不能为空' };
  }

  if (typeof username !== 'string') {
    return { valid: false, error: '用户名必须是字符串' };
  }

  // 移除可能的 @ 前缀和空格
  let normalized = username.trim().replace(/^@/, '');

  // Twitter 用户名规则：
  // - 长度 1-15 字符
  // - 只能包含字母、数字、下划线
  if (normalized.length === 0) {
    return { valid: false, error: '用户名不能为空' };
  }

  if (normalized.length > 15) {
    return { valid: false, error: '用户名长度不能超过 15 个字符' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(normalized)) {
    return { valid: false, error: '用户名只能包含字母、数字和下划线' };
  }

  return { valid: true, normalized };
}

interface Cookie {
  name: string;
  value: string;
  domain?: string;
  expires?: number;
  [key: string]: any;
}

/**
 * 验证 Cookie 对象的结构
 */
export function isValidCookieObject(cookie: any): boolean {
  if (!cookie || typeof cookie !== 'object') {
    return false;
  }

  // Cookie 必须有 name 和 value
  if (!cookie.name || typeof cookie.name !== 'string') {
    return false;
  }

  if (cookie.value === undefined || cookie.value === null) {
    return false;
  }

  // domain 应该是字符串（如果存在）
  if (cookie.domain && typeof cookie.domain !== 'string') {
    return false;
  }

  return true;
}

interface CookieValidationResult {
  valid: boolean;
  error?: string;
  validCount?: number;
  cookies?: Cookie[];
  filteredCount?: number;
}

/**
 * 验证 Cookies 数组
 */
export function validateCookies(cookies: any): CookieValidationResult {
  if (!Array.isArray(cookies)) {
    return { valid: false, error: 'Cookies 必须是数组' };
  }

  if (cookies.length === 0) {
    return { valid: false, error: 'Cookies 数组不能为空' };
  }

  // 检查每个 Cookie 的有效性
  const invalidCookies: number[] = [];
  const initialValidCookies: Cookie[] = [];

  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i];
    if (!isValidCookieObject(cookie)) {
      invalidCookies.push(i);
    } else {
      initialValidCookies.push(cookie);
    }
  }

  if (invalidCookies.length > 0) {
    return {
      valid: false,
      error: `发现 ${invalidCookies.length} 个无效的 Cookie（索引: ${invalidCookies.join(', ')}）`
    };
  }

  // 检查过期时间并过滤
  const now = Date.now() / 1000; // 当前时间（秒）
  const expiredCookies: { name: string; expiredAt: string }[] = [];
  const validCookies: Cookie[] = [];

  initialValidCookies.forEach(cookie => {
    // Cloudflare bot mitigation cookie (__cf_bm) is required even when expired; keep it.
    if (cookie.name === '__cf_bm') {
      validCookies.push(cookie);
      return;
    }

    // 跳过值为 -1 或 0 的 expires（这些是 session cookies，永远不会过期）
    if (cookie.expires && cookie.expires !== -1 && cookie.expires !== 0) {
      if (cookie.expires < now) {
        expiredCookies.push({
          name: cookie.name,
          expiredAt: new Date(cookie.expires * 1000).toISOString()
        });
      } else {
        validCookies.push(cookie);
      }
    } else {
      // Session cookie 或无过期时间，保留
      validCookies.push(cookie);
    }
  });

  // 如果有过期的 cookie，记录警告但不报错
  if (expiredCookies.length > 0) {
    console.warn(`[Cookie Validation] Found ${expiredCookies.length} expired cookie(s), automatically filtering them out:`);
    expiredCookies.forEach(c => {
      console.warn(`  - ${c.name} (expired at ${c.expiredAt})`);
    });
  }

  // 检查是否还有足够的有效 cookie（至少需要 auth_token 或 ct0）
  const hasAuthToken = validCookies.some(c => c.name === 'auth_token');
  const hasCt0 = validCookies.some(c => c.name === 'ct0');

  if (!hasAuthToken && !hasCt0) {
    return {
      valid: false,
      error: 'Missing critical authentication cookies (auth_token or ct0) after filtering expired cookies. Please update your cookies.'
    };
  }

  return {
    valid: true,
    validCount: validCookies.length,
    cookies: validCookies,
    filteredCount: expiredCookies.length
  };
}

interface EnvCookieDataResult {
  valid: boolean;
  error?: string;
  cookies?: Cookie[];
  username?: string | null;
  validCount?: number;
  filteredCount?: number;
}

/**
 * 验证 Cookie file 格式的 Cookie 数据
 */
export function validateEnvCookieData(envData: any): EnvCookieDataResult {
  if (!envData || typeof envData !== 'object') {
    return { valid: false, error: 'Cookie file content must be an object' };
  }

  let cookies: any;

  // 支持两种格式
  if (Array.isArray(envData)) {
    // 旧格式：直接是数组
    cookies = envData;
  } else if (Array.isArray(envData.cookies)) {
    // 新格式：包含 cookies 字段的对象
    cookies = envData.cookies;
  } else {
    return {
      valid: false,
      error: 'Cookie file must be an array of cookies or an object containing a "cookies" field'
    };
  }

  // 验证 Cookies
  const cookieValidation = validateCookies(cookies);
  if (!cookieValidation.valid) {
    return { valid: false, error: cookieValidation.error };
  }

  return {
    valid: true,
    cookies: cookieValidation.cookies,
    username: envData.username || null
  };
}

interface TwitterUrlResult {
  valid: boolean;
  error?: string;
  username?: string | null;
  withReplies?: boolean;
}

/**
 * 验证 Twitter URL
 */
export function validateTwitterUrl(url: any): TwitterUrlResult {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL 必须是字符串' };
  }

  try {
    const urlObj = new URL(url);

    // 检查是否是 Twitter/X 域名
    if (!['twitter.com', 'x.com', 'www.twitter.com', 'www.x.com'].includes(urlObj.hostname)) {
      return { valid: false, error: 'URL 必须是 Twitter 或 X 的域名' };
    }

    // 解析路径
    const pathParts = urlObj.pathname.split('/').filter(p => p);

    if (pathParts.length === 0) {
      // 只是主页
      return { valid: true, username: null, withReplies: false };
    }

    // 提取用户名
    const username = pathParts[0].replace(/^@/, '');

    // 检查是否有 with_replies
    const withReplies = pathParts.includes('with_replies');

    // 验证用户名格式
    const usernameValidation = validateTwitterUsername(username);
    if (!usernameValidation.valid) {
      return { valid: false, error: `URL 中的用户名无效: ${usernameValidation.error}` };
    }

    return {
      valid: true,
      username: usernameValidation.normalized,
      withReplies
    };
  } catch (error: any) {
    return { valid: false, error: `无效的 URL 格式: ${error.message}` };
  }
}

interface ScraperConfigResult {
  valid: boolean;
  errors: string[];
}

/**
 * 验证配置对象
 */
export function validateScraperConfig(config: any): ScraperConfigResult {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['配置必须是对象'] };
  }

  // 验证 limit
  if (config.limit !== undefined) {
    if (typeof config.limit !== 'number' || config.limit <= 0) {
      errors.push('limit 必须是大于 0 的数字');
    }
    if (config.limit > 1000) {
      errors.push('limit 不应超过 1000（避免过长的爬取时间）');
    }
  }

  // 验证 username（如果存在）
  if (config.username !== undefined && config.username !== null) {
    const usernameValidation = validateTwitterUsername(config.username);
    if (!usernameValidation.valid) {
      errors.push(`username 无效: ${usernameValidation.error}`);
    }
  }

  // 验证布尔选项
  const booleanOptions = ['saveMarkdown', 'saveScreenshots', 'exportCsv', 'exportJson', 'withReplies'];
  for (const option of booleanOptions) {
    if (config[option] !== undefined && typeof config[option] !== 'boolean') {
      errors.push(`${option} 必须是布尔值`);
    }
  }

  // 验证 outputDir（如果存在）
  if (config.outputDir !== undefined) {
    if (typeof config.outputDir !== 'string') {
      errors.push('outputDir 必须是字符串');
    } else if (config.outputDir.trim() === '') {
      errors.push('outputDir 不能为空字符串');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

interface UsernameInputResult {
  valid: boolean;
  usernames: string[];
  errors: string[];
}

/**
 * 清理和规范化用户名输入
 */
export function normalizeUsernameInput(input: any): UsernameInputResult {
  const errors: string[] = [];
  const usernames: string[] = [];

  if (!input) {
    return { valid: false, usernames: [], errors: ['输入不能为空'] };
  }

  // 转换为数组
  let inputs = Array.isArray(input) ? input : [input];

  for (const item of inputs) {
    if (!item || typeof item !== 'string') {
      errors.push(`无效的输入项: ${JSON.stringify(item)}`);
      continue;
    }

    // 清理和验证
    const validation = validateTwitterUsername(item);
    if (validation.valid) {
      usernames.push(validation.normalized!);
    } else {
      errors.push(`"${item}": ${validation.error}`);
    }
  }

  return {
    valid: errors.length === 0 && usernames.length > 0,
    usernames: [...new Set(usernames)], // 去重
    errors
  };
}
