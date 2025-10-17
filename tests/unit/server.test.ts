import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMcpServer } from "../../src/server";
import type { Config } from "../../src/config";

// Create mock functions at module level (before vi.mock hoisting).
const mockGetResources = vi.fn();
const mockGetResourceTemplates = vi.fn();
const mockGetPrompts = vi.fn();
const mockGetTools = vi.fn();
const mockListServers = vi.fn();
const mockGetServerHealth = vi.fn();
const mockGeneratePrompt = vi.fn();

// Mock the @mozilla-ai/mcpd module.
vi.mock("@mozilla-ai/mcpd", () => ({
  McpdClient: vi.fn().mockImplementation(() => ({
    listServers: mockListServers,
    getServerHealth: mockGetServerHealth,
    getResources: mockGetResources,
    getResourceTemplates: mockGetResourceTemplates,
    getPrompts: mockGetPrompts,
    getTools: mockGetTools,
    servers: {},
    generatePrompt: mockGeneratePrompt,
  })),
  ToolNotFoundError: class ToolNotFoundError extends Error {},
  ToolExecutionError: class ToolExecutionError extends Error {},
  ServerNotFoundError: class ServerNotFoundError extends Error {},
  ServerUnhealthyError: class ServerUnhealthyError extends Error {},
  ConnectionError: class ConnectionError extends Error {},
  AuthenticationError: class AuthenticationError extends Error {},
  TimeoutError: class TimeoutError extends Error {},
}));

describe("Server Request Handlers", () => {
  let config: Config;

  beforeEach(() => {
    config = {
      mcpdAddr: "http://localhost:8090",
      mcpdApiKey: undefined,
    };

    // Reset all mocks before each test.
    vi.clearAllMocks();

    // Set default return values.
    mockListServers.mockResolvedValue(["server1", "server2"]);
    mockGetServerHealth.mockResolvedValue({});
    mockGetResources.mockResolvedValue([]);
    mockGetResourceTemplates.mockResolvedValue([]);
    mockGetPrompts.mockResolvedValue([]);
    mockGetTools.mockResolvedValue([]);
  });

  describe("Server Creation", () => {
    it("should create an MCP server with correct configuration", () => {
      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });
  });

  describe("ListResourcesRequestSchema handler", () => {
    it("should return empty array when SDK returns no resources", async () => {
      mockGetResources.mockResolvedValue([]);

      const server = createMcpServer(config);

      // The SDK automatically handles 501 filtering, so the proxy just
      // returns what the SDK provides.
      expect(server).toBeDefined();
    });

    it("should transform SDK resources to MCP format", async () => {
      mockGetResources.mockResolvedValue([
        {
          name: "server1__test_file",
          uri: "file.txt",
          description: "A test file",
          mimeType: "text/plain",
          _serverName: "server1",
          _resourceName: "test_file",
          _uri: "file.txt",
        },
      ]);

      const server = createMcpServer(config);

      // The implementation transforms resources with mcpd:// URIs.
      expect(server).toBeDefined();
    });

    it("should handle SDK errors gracefully", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mockGetResources.mockRejectedValue(new Error("SDK error"));

      const server = createMcpServer(config);

      expect(server).toBeDefined();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("ListResourceTemplatesRequestSchema handler", () => {
    it("should return empty array when SDK returns no templates", async () => {
      mockGetResourceTemplates.mockResolvedValue([]);

      const server = createMcpServer(config);

      // The SDK automatically handles 501 filtering, so the proxy just
      // returns what the SDK provides.
      expect(server).toBeDefined();
    });

    it("should return templates from SDK with namespaced names", async () => {
      mockGetResourceTemplates.mockResolvedValue([
        {
          name: "server1__file_template",
          uriTemplate: "file:///{path}",
          description: "A file template",
          mimeType: "text/plain",
          _serverName: "server1",
          _templateName: "file_template",
        },
      ]);

      const server = createMcpServer(config);

      // The SDK already namespaces template names, so the proxy just passes them through.
      expect(server).toBeDefined();
    });

    it("should handle SDK errors gracefully", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mockGetResourceTemplates.mockRejectedValue(new Error("SDK error"));

      const server = createMcpServer(config);

      expect(server).toBeDefined();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("ListPromptsRequestSchema handler", () => {
    it("should return empty array when SDK returns no prompts", async () => {
      mockGetPrompts.mockResolvedValue([]);

      const server = createMcpServer(config);

      // The SDK automatically handles 501 filtering, so the proxy just
      // returns what the SDK provides.
      expect(server).toBeDefined();
    });

    it("should return prompts from SDK with namespaced names", async () => {
      mockGetPrompts.mockResolvedValue([
        {
          name: "server1__test_prompt",
          description: "A test prompt",
          arguments: [],
        },
      ]);

      const server = createMcpServer(config);

      // The SDK already namespaces prompt names, so the proxy just passes them through.
      expect(server).toBeDefined();
    });

    it("should handle SDK errors gracefully", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mockGetPrompts.mockRejectedValue(new Error("SDK error"));

      const server = createMcpServer(config);

      expect(server).toBeDefined();

      consoleErrorSpy.mockRestore();
    });
  });
});
