#!/usr/bin/env node
/**
 * Converts Netscape cookie file format to JSON format for Puppeteer.
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Parses a Netscape cookie file line.
 * Based on spec: http://curl.haxx.se/rfc/cookie_spec.html
 * Handles potential variations in column count.
 */
function parseNetscapeCookieLine(line) {
  if (!line || line.startsWith('#')) {
    return null; // Skip comments and empty lines
  }

  const parts = line.trim().split('\t');
  if (parts.length < 7) {
    // console.warn('Skipping malformed cookie line:', line);
    return null; // Needs at least 7 columns
  }

  const [domain, includeSubdomainsStr, cookiePath, secureStr, expiresTimestampStr, name, value] = parts;
  const isSecure = secureStr.toUpperCase() === 'TRUE';
  const expiresTimestamp = parseInt(expiresTimestampStr, 10);

  const cookie = {
    name,
    value,
    domain: domain.startsWith('.') ? domain : domain, // Keep leading dot if present
    path: cookiePath,
    secure: isSecure,
    httpOnly: false, // Netscape format doesn't store this, default to false
    // session: expiresTimestamp === 0 || isNaN(expiresTimestamp), // Treat 0 as session? Puppeteer uses expires = -1
  };

  // Handle expiration
  if (expiresTimestamp > 0) {
    cookie.expires = expiresTimestamp;
  } else {
    // Puppeteer uses -1 for session cookies
    cookie.expires = -1;
  }

  return cookie;
}

/**
 * Converts a Netscape cookie file to Puppeteer-compatible JSON.
 * @param {string} inputFile Path to the Netscape cookie file.
 * @param {string} outputFile Path to save the JSON output file.
 */
async function convertCookieFile(inputFile, outputFile) {
  console.log(`Converting ${inputFile} to ${outputFile}...`);
  try {
    const fileContent = await fs.readFile(inputFile, 'utf-8');
    const lines = fileContent.split('\n');
    const cookies = lines.map(parseNetscapeCookieLine).filter(Boolean);

    if (cookies.length === 0) {
      console.warn('No valid cookies found in the input file.');
      return;
    }

    // Prepare output object (similar to env.json structure)
    const outputData = {
      // You might want to add a username here manually if needed
      // username: "YourMediumUsername",
      cookies: cookies
    };

    await fs.writeFile(outputFile, JSON.stringify(outputData, null, 2), 'utf-8');
    console.log(`✅ Successfully converted ${cookies.length} cookies to ${outputFile}`);

  } catch (error) {
    console.error(`Error converting cookie file: ${error.message}`);
    if (error.code === 'ENOENT') {
        console.error(`Input file not found: ${inputFile}`);
    }
  }
}

// --- Main execution --- 
// Get input and output file paths from command line arguments
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: node convert-cookies.js <input_netscape_file> <output_json_file>');
  process.exit(1);
}

const [inputFile, outputFile] = args;

convertCookieFile(inputFile, outputFile); 