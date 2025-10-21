/**
 * 验证工具模块
 * 提供输入验证、Cookie 验证等功能
 */

/**
 * 验证 Twitter 用户名格式
 * @param {string} username - 用户名
 * @returns {Object} - { valid: boolean, error?: string, normalized?: string }
 */
function validateTwitterUsername(username) {
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

/**
 * 验证 Cookie 对象的结构
 * @param {Object} cookie - Cookie 对象
 * @returns {boolean} - 是否有效
 */
function isValidCookieObject(cookie) {
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

/**
 * 验证 Cookies 数组
 * @param {Array} cookies - Cookies 数组
 * @returns {Object} - { valid: boolean, error?: string, validCount?: number }
 */
function validateCookies(cookies) {
  if (!Array.isArray(cookies)) {
    return { valid: false, error: 'Cookies 必须是数组' };
  }

  if (cookies.length === 0) {
    return { valid: false, error: 'Cookies 数组不能为空' };
  }

  // 检查每个 Cookie 的有效性
  const invalidCookies = [];
  const expiredCookies = [];
  const now = Date.now() / 1000; // 转换为秒

  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i];

    if (!isValidCookieObject(cookie)) {
      invalidCookies.push(i);
      continue;
    }

    // 检查是否过期
    if (cookie.expires && typeof cookie.expires === 'number') {
      if (cookie.expires < now) {
        expiredCookies.push({
          index: i,
          name: cookie.name,
          expires: new Date(cookie.expires * 1000).toISOString()
        });
      }
    }
  }

  if (invalidCookies.length > 0) {
    return {
      valid: false,
      error: `发现 ${invalidCookies.length} 个无效的 Cookie（索引: ${invalidCookies.join(', ')}）`
    };
  }

  if (expiredCookies.length > 0) {
    const expiredInfo = expiredCookies
      .map(c => `${c.name} (过期于 ${c.expires})`)
      .join(', ');
    return {
      valid: false,
      error: `发现 ${expiredCookies.length} 个已过期的 Cookie: ${expiredInfo}`,
      expiredCookies
    };
  }

  return { valid: true, validCount: cookies.length };
}

/**
 * 验证 env.json 格式的 Cookie 数据
 * @param {Object} envData - env.json 的内容
 * @returns {Object} - { valid: boolean, error?: string, cookies?: Array }
 */
function validateEnvCookieData(envData) {
  if (!envData || typeof envData !== 'object') {
    return { valid: false, error: 'env.json 内容必须是对象' };
  }

  let cookies;

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
      error: 'env.json 必须是 Cookie 数组，或包含 cookies 字段的对象'
    };
  }

  // 验证 Cookies
  const cookieValidation = validateCookies(cookies);
  if (!cookieValidation.valid) {
    return cookieValidation;
  }

  return {
    valid: true,
    cookies,
    username: envData.username || null
  };
}

/**
 * 验证 Twitter URL
 * @param {string} url - URL 字符串
 * @returns {Object} - { valid: boolean, error?: string, username?: string, withReplies?: boolean }
 */
function validateTwitterUrl(url) {
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
  } catch (error) {
    return { valid: false, error: `无效的 URL 格式: ${error.message}` };
  }
}

/**
 * 验证配置对象
 * @param {Object} config - 配置对象
 * @returns {Object} - { valid: boolean, errors: Array<string> }
 */
function validateScraperConfig(config) {
  const errors = [];

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

/**
 * 清理和规范化用户名输入
 * @param {string|Array<string>} input - 用户名输入
 * @returns {Object} - { valid: boolean, usernames: Array<string>, errors: Array<string> }
 */
function normalizeUsernameInput(input) {
  const errors = [];
  const usernames = [];

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
      usernames.push(validation.normalized);
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

module.exports = {
  validateTwitterUsername,
  validateCookies,
  validateEnvCookieData,
  validateTwitterUrl,
  validateScraperConfig,
  normalizeUsernameInput,
  isValidCookieObject
};
