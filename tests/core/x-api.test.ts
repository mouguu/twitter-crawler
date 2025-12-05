import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
/**
 * XApiClient 单元测试
 */

import { XApiClient } from "../../core/x-api";
import { Protocol } from "puppeteer";

// Mock fetch using Bun's mock
const mockFetch = mock(() => Promise.resolve(new Response()));

// Store original fetch
const originalFetch = globalThis.fetch;

// Mock XClIdGen
mock.module("../../core/xclid", () => ({
  XClIdGen: {
    create: mock(() =>
      Promise.resolve({
        calc: mock(() => "mock-xclid"),
      })
    ),
  },
}));

describe("XApiClient", () => {
  let client: XApiClient;
  let mockCookies: Protocol.Network.CookieParam[];

  beforeEach(() => {
    mockCookies = [
      { name: "auth_token", value: "token123", domain: ".x.com" },
      { name: "ct0", value: "csrf123", domain: ".x.com" },
    ];
    client = new XApiClient(mockCookies);
    mockFetch.mockClear();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  describe("constructor", () => {
    test("should initialize with cookies", () => {
      expect(client).toBeDefined();
    });

    test("should build headers from cookies", () => {
      const client = new XApiClient(mockCookies);
      expect(client).toBeDefined();
    });
  });

  describe("getUserByScreenName", () => {
    test("should return user ID for valid screen name", async () => {
      const mockResponse = {
        data: {
          user: {
            result: {
              rest_id: "123456789",
            },
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const userId = await client.getUserByScreenName("testuser");

      expect(userId).toBe("123456789");
      expect(mockFetch).toHaveBeenCalled();
    });

    test("should throw error for invalid screen name", async () => {
      const mockResponse = {
        data: {
          user: {
            result: null,
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await expect(client.getUserByScreenName("invaliduser")).rejects.toThrow();
    });

    test("should handle API errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      await expect(client.getUserByScreenName("testuser")).rejects.toThrow();
    });

    test("should handle network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.getUserByScreenName("testuser")).rejects.toThrow();
    });
  });

  describe("getUserTweets", () => {
    test("should fetch user tweets", async () => {
      const mockResponse = {
        data: {
          user: {
            result: {
              timeline_v2: {
                timeline: {
                  instructions: [],
                },
              },
            },
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await client.getUserTweets("123456789", 20);

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalled();
    });

    test("should include cursor for pagination", async () => {
      const mockResponse = { data: {} };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await client.getUserTweets("123456789", 20, "cursor123");

      const callArgs = mockFetch.mock.calls[0] as unknown[];
      const url = callArgs?.[0] as string;
      expect(url).toContain("cursor123");
    });
  });

  describe("searchTweets", () => {
    test("should search tweets with query", async () => {
      const mockResponse = {
        data: {
          search_by_raw_query: {
            search_timeline: {
              timeline: {
                instructions: [],
              },
            },
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await client.searchTweets("test query", 20);

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalled();
    });

    test("should include cursor for pagination", async () => {
      const mockResponse = { data: {} };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await client.searchTweets("test", 20, "cursor123");

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("getTweetDetail", () => {
    test("should fetch tweet detail", async () => {
      const mockResponse = {
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [],
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await client.getTweetDetail("tweet123");

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalled();
    });

    test("should include cursor for pagination", async () => {
      const mockResponse = { data: {} };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await client.getTweetDetail("tweet123", "cursor123");

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("rate limit handling", () => {
    test("should throw rate limit error on 429", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as Response);

      await expect(client.getUserTweets("123456789")).rejects.toThrow();
    });
  });

  describe("authentication handling", () => {
    test("should throw auth error on 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      await expect(client.getUserTweets("123456789")).rejects.toThrow();
    });

    test("should throw auth error on 403", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as Response);

      await expect(client.getUserTweets("123456789")).rejects.toThrow();
    });
  });
});
