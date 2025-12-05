import crypto from 'crypto';
import { ScraperErrors } from './errors';

const INDICES_REGEX = /(\(\w{1}\[(\d{1,2})\],\s*16\))+/gm;

const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

function interpolate(from: number[], to: number[], f: number): number[] {
    if (from.length !== to.length) throw ScraperErrors.invalidConfiguration('Interpolation arg length mismatch');
    return from.map((a, i) => a * (1 - f) + to[i] * f);
}

function getRotationMatrix(rotation: number): number[] {
    const rad = (rotation * Math.PI) / 180;
    return [Math.cos(rad), -Math.sin(rad), Math.sin(rad), Math.cos(rad)];
}

function solve(value: number, minVal: number, maxVal: number, rounding: boolean): number {
    const result = (value * (maxVal - minVal)) / 255 + minVal;
    return rounding ? Math.floor(result) : Math.round(result * 100) / 100;
}

function floatToHex(x: number): string {
    const intPart = Math.floor(x);
    let quotient = intPart;
    let remainder = 0;
    const result: string[] = [];

    while (quotient > 0) {
        quotient = Math.floor(x / 16);
        remainder = Math.floor(x - quotient * 16);
        result.unshift(remainder > 9 ? String.fromCharCode(remainder + 55) : remainder.toString());
        x = quotient;
    }

    const fraction = x - Math.floor(x);
    if (fraction === 0) return result.join('') || '0';
    result.push('.');

    let frac = fraction;
    let guard = 0;
    while (frac > 0 && guard < 8) {
        frac *= 16;
        const integer = Math.floor(frac);
        frac -= integer;
        result.push(integer > 9 ? String.fromCharCode(integer + 55) : integer.toString());
        guard++;
    }
    return result.join('');
}

class Cubic {
    constructor(private curves: number[]) {}

    private calculate(a: number, b: number, m: number): number {
        return 3 * a * (1 - m) * (1 - m) * m + 3 * b * (1 - m) * m * m + m * m * m;
    }

    getValue(time: number): number {
        let start = 0;
        let end = 1;
        let mid = 0;
        let startGradient = 0;
        let endGradient = 0;

        if (time <= 0) {
            if (this.curves[0] > 0) {
                startGradient = this.curves[1] / this.curves[0];
            } else if (this.curves[1] === 0 && this.curves[2] > 0) {
                startGradient = this.curves[3] / this.curves[2];
            }
            return startGradient * time;
        }

        if (time >= 1) {
            if (this.curves[2] < 1) {
                endGradient = (this.curves[3] - 1) / (this.curves[2] - 1);
            } else if (this.curves[2] === 1 && this.curves[0] < 1) {
                endGradient = (this.curves[1] - 1) / (this.curves[0] - 1);
            }
            return 1 + endGradient * (time - 1);
        }

        while (start < end) {
            mid = (start + end) / 2;
            const xEst = this.calculate(this.curves[0], this.curves[2], mid);
            if (Math.abs(time - xEst) < 0.00001) {
                return this.calculate(this.curves[1], this.curves[3], mid);
            }
            if (xEst < time) {
                start = mid;
            } else {
                end = mid;
            }
        }
        return this.calculate(this.curves[1], this.curves[3], mid);
    }
}

async function getPageText(url: string, headers: Record<string, string>): Promise<string> {
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw ScraperErrors.apiRequestFailed(`Failed to load ${url}`, resp.status, { url });
    const text = await resp.text();
    if (!text.includes('>document.location =')) return text;

    const redirect = text.split('document.location = "')[1]?.split('"')[0];
    if (!redirect) return text;
    const redirected = await fetch(redirect, { headers });
    if (!redirected.ok) throw ScraperErrors.apiRequestFailed(`Failed migrate redirect`, redirected.status, { redirect });
    const migrated = await redirected.text();
    if (!migrated.includes('action="https://x.com/x/migrate"')) return migrated;

    // Fallback: try to post migrate JSON payload
    const data: Record<string, string> = {};
    for (const chunk of migrated.split('<input').slice(1)) {
        const name = chunk.split('name="')[1]?.split('"')[0];
        const value = chunk.split('value="')[1]?.split('"')[0];
        if (name && value !== undefined) data[name] = value;
    }
    const finalResp = await fetch('https://x.com/x/migrate', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!finalResp.ok) throw ScraperErrors.apiRequestFailed(`Migrate post failed`, finalResp.status, { url: 'https://x.com/x/migrate' });
    return await finalResp.text();
}

function extractVkBytes(html: string): number[] {
    const match = html.match(/twitter-site-verification" content="([^"]+)"/);
    if (!match) throw ScraperErrors.dataExtractionFailed('Could not find twitter-site-verification meta');
    return Array.from(Buffer.from(match[1], 'base64'));
}

function extractScriptsList(html: string): string[] {
    const parts = html.split('e=>e+"."+');
    if (parts.length < 2) throw ScraperErrors.dataExtractionFailed('Cannot locate scripts manifest');
    const second = parts[1].split('[e]+"a.js"')[0];
    const parsed = JSON.parse(second);
    return Object.entries(parsed).map(
        ([k, v]) => `https://abs.twimg.com/responsive-web/client-web/${k}.${(v as string)}a.js`
    );
}

async function parseAnimIdx(html: string): Promise<number[]> {
    const scripts = extractScriptsList(html).filter(u => u.includes('/ondemand.s.'));
    if (!scripts.length) throw ScraperErrors.dataExtractionFailed('No ondemand.s.* script found');
    const scriptResp = await fetch(scripts[0]);
    if (!scriptResp.ok) throw ScraperErrors.apiRequestFailed(`Failed to load script`, scriptResp.status, { url: scripts[0] });
    const scriptText = await scriptResp.text();
    const matches = [...scriptText.matchAll(INDICES_REGEX)].flatMap(m => Number(m[2]));
    if (!matches.length) throw ScraperErrors.dataExtractionFailed('No animation indices found');
    return matches;
}

function parseAnimArr(html: string, vkBytes: number[]): number[][] {
    const svgBlocks = [...html.matchAll(/<svg[^>]*id="loading-x-anim[^"]*"[^>]*>[\s\S]*?<\/svg>/g)];
    if (!svgBlocks.length) throw ScraperErrors.dataExtractionFailed("Couldn't get loading-x-anim svg");

    const pathDs: string[] = [];
    for (const block of svgBlocks) {
        const paths = [...block[0].matchAll(/<path[^>]*d="([^"]+)"[^>]*>/g)].map(m => m[1]);
        if (paths.length >= 2) {
            pathDs.push(paths[1]);
        }
    }
    if (!pathDs.length) throw ScraperErrors.dataExtractionFailed("Couldn't parse animation paths");

    const idx = vkBytes[5] % pathDs.length;
    const chosen = pathDs[idx];
    return chosen
        .slice(9)
        .split('C')
        .map(seg => seg.replace(/[^\d. -]/g, ' ').trim())
        .map(seg => seg.split(/\s+/).map(Number));
}

async function loadKeys(html: string): Promise<{ vkBytes: number[]; animKey: string }> {
    const animIdx = await parseAnimIdx(html);
    const vkBytes = extractVkBytes(html);
    const animArr = parseAnimArr(html, vkBytes);

    let frameTime = 1;
    for (const x of animIdx.slice(1)) {
        frameTime *= vkBytes[x] % 16;
    }
    const frameIdx = vkBytes[animIdx[0]] % 16;
    const frameRow = animArr[frameIdx];
    const frameDur = frameTime / 4096;

    const animKey = calcAnimKey(frameRow, frameDur);
    return { vkBytes, animKey };
}

function calcAnimKey(frames: number[], targetTime: number): string {
    const fromColor = [...frames.slice(0, 3), 1];
    const toColor = [...frames.slice(3, 6), 1];
    const fromRotation = [0];
    const toRotation = [solve(frames[6], 60, 360, true)];
    const curves = frames.slice(7).map((x, i) => solve(x, i % 2 ? -1 : 0, 1, false));
    const val = new Cubic(curves).getValue(targetTime);

    const color = interpolate(fromColor, toColor, val).map(v => (v > 0 ? v : 0));
    const rotation = interpolate(fromRotation, toRotation, val);
    const matrix = getRotationMatrix(rotation[0]);
    const strArr = color.slice(0, -1).map(v => Math.round(v).toString(16));
    for (const value of matrix) {
        const rounded = Math.abs(Math.round(value * 100) / 100);
        const hex = floatToHex(rounded);
        strArr.push(hex.startsWith('.') ? `0${hex}` : hex || '0');
    }
    strArr.push('0', '0');
    return strArr.join('').replace(/[.-]/g, '');
}

export class XClIdGen {
    private constructor(private vkBytes: number[], private animKey: string) {}

    static async create(cookiesHeader: string, userAgent: string = DEFAULT_USER_AGENT): Promise<XClIdGen> {
        const headers = {
            'user-agent': userAgent,
            cookie: cookiesHeader
        };
        const html = await getPageText('https://x.com/tesla', headers);
        const { vkBytes, animKey } = await loadKeys(html);
        return new XClIdGen(vkBytes, animKey);
    }

    calc(method: string, path: string): string {
        const ts = Math.floor((Date.now() - 1682924400000) / 1000);
        const tsBytes = [0, 1, 2, 3].map(i => (ts >> (i * 8)) & 0xff);
        const dkw = 'obfiowerehiring';
        const drn = 3;
        const payload = `${method.toUpperCase()}!${path}!${ts}${dkw}${this.animKey}`;
        const hash = crypto.createHash('sha256').update(payload).digest();
        const merged = [...this.vkBytes, ...tsBytes, ...hash.slice(0, 16), drn];
        const num = Math.floor(Math.random() * 256);
        const xored = Uint8Array.from([num, ...merged.map(x => x ^ num)]);
        return Buffer.from(xored).toString('base64').replace(/=+$/, '');
    }
}
