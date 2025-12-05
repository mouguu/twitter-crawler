import { describe, test, expect, mock } from 'bun:test';
import { createApiKeyMiddleware } from '../../middleware/api-key';
import { Request, Response } from 'express';

function mockRes() {
    const res: Partial<Response> = {};
    res.statusCode = 200;
    res.status = mock((code: number) => {
        res.statusCode = code;
        return res as Response;
    });
    res.json = mock(() => res as Response);
    return res as Response & { statusCode: number };
}

describe('api-key middleware', () => {
    test('allows when API key is not configured', () => {
        const middleware = createApiKeyMiddleware(undefined);
        const next = mock(() => {});
        const req = { headers: {}, query: {} } as unknown as Request;
        const res = mockRes();

        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('rejects when key is configured and missing', () => {
        const middleware = createApiKeyMiddleware('secret');
        const next = mock(() => {});
        const req = { headers: {}, query: {} } as unknown as Request;
        const res = mockRes();

        middleware(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('accepts matching x-api-key header', () => {
        const middleware = createApiKeyMiddleware('secret');
        const next = mock(() => {});
        const req = { headers: { 'x-api-key': 'secret' }, query: {} } as unknown as Request;
        const res = mockRes();

        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('accepts matching api_key query param', () => {
        const middleware = createApiKeyMiddleware('secret');
        const next = mock(() => {});
        const req = { headers: {}, query: { api_key: 'secret' } } as unknown as Request;
        const res = mockRes();

        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});
