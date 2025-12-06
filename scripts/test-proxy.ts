#!/usr/bin/env bun

/**
 * Test script to verify proxy authentication
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// Load proxy from file
const proxyFile = path.join(process.cwd(), 'proxy', 'Webshare 10 proxies.txt');
const content = fs.readFileSync(proxyFile, 'utf-8');
const lines = content.split('\n').filter(l => l.trim().length > 0);

if (lines.length === 0) {
  console.error('❌ No proxies found in file');
  process.exit(1);
}

// Parse first proxy
const line = lines[1] || lines[0]; // Skip first empty line if exists
const parts = line.trim().split(':');
if (parts.length < 4) {
  console.error('❌ Invalid proxy format:', line);
  process.exit(1);
}

const host = parts[0];
const port = parseInt(parts[1], 10);
const username = parts[2];
const password = parts.slice(3).join(':'); // Handle passwords with ':'

console.log('🔍 Testing proxy configuration...');
console.log(`   Host: ${host}`);
console.log(`   Port: ${port}`);
console.log(`   Username: ${username}`);
console.log(`   Password: ${password.substring(0, 3)}*** (length: ${password.length})`);
console.log('');

// Test 1: Axios with proxy.auth (current method)
console.log('📡 Test 1: Axios with proxy.auth configuration');
try {
  const response = await axios.get('https://www.reddit.com/r/singularity/hot.json?limit=1', {
    proxy: {
      host,
      port,
      protocol: 'http',
      auth: {
        username,
        password,
      },
    },
    timeout: 10000,
    validateStatus: (status) => status < 500,
  });

  console.log(`   ✅ Status: ${response.status}`);
  console.log(`   ✅ Response size: ${JSON.stringify(response.data).length} bytes`);
  if (response.data?.kind === 'Listing') {
    console.log(`   ✅ Success! Got ${response.data.data?.children?.length || 0} posts`);
  } else {
    console.log(`   ⚠️  Unexpected response kind: ${response.data?.kind}`);
    console.log(`   Response preview: ${JSON.stringify(response.data).substring(0, 200)}`);
  }
} catch (error: any) {
  console.log(`   ❌ Failed: ${error.message}`);
  if (error.response) {
    console.log(`   Status: ${error.response.status} ${error.response.statusText}`);
    console.log(`   Response: ${JSON.stringify(error.response.data).substring(0, 200)}`);
  }
  if (error.code) {
    console.log(`   Code: ${error.code}`);
  }
}
console.log('');

// Test 2: Axios with proxy URL (alternative method)
console.log('📡 Test 2: Axios with proxy URL (http://user:pass@host:port)');
try {
  const proxyUrl = `http://${username}:${password}@${host}:${port}`;
  const response = await axios.get('https://www.reddit.com/r/singularity/hot.json?limit=1', {
    proxy: {
      host,
      port,
      protocol: 'http',
      auth: {
        username,
        password,
      },
    },
    // Alternative: use httpAgent with proxy
    httpAgent: require('http').Agent({
      keepAlive: true,
    }),
    httpsAgent: require('https').Agent({
      keepAlive: true,
    }),
    timeout: 10000,
    validateStatus: (status) => status < 500,
  });

  console.log(`   ✅ Status: ${response.status}`);
  console.log(`   ✅ Response size: ${JSON.stringify(response.data).length} bytes`);
  if (response.data?.kind === 'Listing') {
    console.log(`   ✅ Success! Got ${response.data.data?.children?.length || 0} posts`);
  } else {
    console.log(`   ⚠️  Unexpected response kind: ${response.data?.kind}`);
  }
} catch (error: any) {
  console.log(`   ❌ Failed: ${error.message}`);
  if (error.response) {
    console.log(`   Status: ${error.response.status} ${error.response.statusText}`);
    console.log(`   Response: ${JSON.stringify(error.response.data).substring(0, 200)}`);
  }
}
console.log('');

// Test 3: Using HttpsProxyAgent (if available)
console.log('📡 Test 3: Using HttpsProxyAgent (npm package)');
try {
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const proxyUrl = `http://${username}:${password}@${host}:${port}`;
  const agent = new HttpsProxyAgent(proxyUrl);

  const response = await axios.get('https://www.reddit.com/r/singularity/hot.json?limit=1', {
    httpsAgent: agent,
    httpAgent: agent,
    timeout: 10000,
    validateStatus: (status) => status < 500,
  });

  console.log(`   ✅ Status: ${response.status}`);
  console.log(`   ✅ Response size: ${JSON.stringify(response.data).length} bytes`);
  if (response.data?.kind === 'Listing') {
    console.log(`   ✅ Success! Got ${response.data.data?.children?.length || 0} posts`);
  } else {
    console.log(`   ⚠️  Unexpected response kind: ${response.data?.kind}`);
  }
} catch (error: any) {
  if (error.code === 'MODULE_NOT_FOUND') {
    console.log(`   ⚠️  https-proxy-agent not installed. Install with: bun add https-proxy-agent`);
  } else {
    console.log(`   ❌ Failed: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status} ${error.response.statusText}`);
      console.log(`   Response: ${JSON.stringify(error.response.data).substring(0, 200)}`);
    }
  }
}
console.log('');

// Test 4: Direct curl command (to verify proxy works at all)
console.log('📡 Test 4: Testing with curl (if available)');
try {
  const { execSync } = require('child_process');
  const proxyUrl = `http://${username}:${password}@${host}:${port}`;
  const result = execSync(
    `curl -x "${proxyUrl}" -s -o /dev/null -w "%{http_code}" "https://www.reddit.com/r/singularity/hot.json?limit=1"`,
    { timeout: 10000, encoding: 'utf-8' }
  );
  console.log(`   ✅ Curl status code: ${result.trim()}`);
} catch (error: any) {
  if (error.message.includes('command not found')) {
    console.log(`   ⚠️  curl not available`);
  } else {
    console.log(`   ❌ Failed: ${error.message}`);
  }
}

console.log('');
console.log('✅ Proxy testing complete!');

