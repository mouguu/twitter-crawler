"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_key_1 = require("../../middleware/api-key");
function mockRes() {
    const res = {};
    res.statusCode = 200;
    res.status = jest.fn().mockImplementation((code) => {
        res.statusCode = code;
        return res;
    });
    res.json = jest.fn().mockImplementation(() => res);
    return res;
}
describe('api-key middleware', () => {
    test('allows when API key is not configured', () => {
        const middleware = (0, api_key_1.createApiKeyMiddleware)(undefined);
        const next = jest.fn();
        const req = { headers: {}, query: {} };
        const res = mockRes();
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
    test('rejects when key is configured and missing', () => {
        const middleware = (0, api_key_1.createApiKeyMiddleware)('secret');
        const next = jest.fn();
        const req = { headers: {}, query: {} };
        const res = mockRes();
        middleware(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
    test('accepts matching x-api-key header', () => {
        const middleware = (0, api_key_1.createApiKeyMiddleware)('secret');
        const next = jest.fn();
        const req = { headers: { 'x-api-key': 'secret' }, query: {} };
        const res = mockRes();
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });
    test('accepts matching api_key query param', () => {
        const middleware = (0, api_key_1.createApiKeyMiddleware)('secret');
        const next = jest.fn();
        const req = { headers: {}, query: { api_key: 'secret' } };
        const res = mockRes();
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});
