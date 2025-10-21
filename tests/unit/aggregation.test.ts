import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getHealthyServers,
  aggregateTools,
  aggregatePrompts,
  aggregateResources,
  aggregateResourceTemplates,
} from "../../src/server";
import type { McpdClient, ServerHealth } from "@mozilla-ai/mcpd";

describe("Aggregation Functions", () => {
  let mockClient: McpdClient;

  beforeEach(() => {
    // Create a mock McpdClient for each test.
    mockClient = {
      listServers: vi.fn(),
      getServerHealth: vi.fn(),
      servers: new Proxy(
        {},
        {
          get: () => ({
            getTools: vi.fn(),
            getPrompts: vi.fn(),
            getResources: vi.fn(),
            getResourceTemplates: vi.fn(),
          }),
        },
      ),
    } as unknown as McpdClient;
  });

  describe("getHealthyServers", () => {
    it("should return only servers with status 'ok'", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
        "server3",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "timeout" },
        server3: { name: "server3", status: "ok" },
      });

      const result = await getHealthyServers(mockClient);

      expect(result).toEqual(["server1", "server3"]);
    });

    it("should filter out unreachable servers", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "unreachable" },
      });

      const result = await getHealthyServers(mockClient);

      expect(result).toEqual(["server1"]);
    });

    it("should return empty array when no servers are healthy", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "timeout" },
        server2: { name: "server2", status: "unreachable" },
      });

      const result = await getHealthyServers(mockClient);

      expect(result).toEqual([]);
    });

    it("should use provided serverNames if specified", async () => {
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        time: { name: "time", status: "ok" },
        fetch: { name: "fetch", status: "ok" },
      });

      const result = await getHealthyServers(mockClient, ["time", "fetch"]);

      expect(result).toEqual(["time", "fetch"]);
      expect(mockClient.listServers).not.toHaveBeenCalled();
    });
  });

  describe("aggregateTools", () => {
    it("should namespace tool names with server__tool format", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue(["time", "fetch"]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        time: { name: "time", status: "ok" },
        fetch: { name: "fetch", status: "ok" },
      });

      // Mock getTools for each server.
      const mockTimeTools = vi.fn().mockResolvedValue([
        {
          name: "get_current_time",
          description: "Get current time",
          inputSchema: { type: "object", properties: {} },
        },
      ]);
      const mockFetchTools = vi.fn().mockResolvedValue([
        {
          name: "fetch_url",
          description: "Fetch URL content",
          inputSchema: { type: "object", properties: {} },
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: (_, serverName) => {
            if (serverName === "time") {
              return { getTools: mockTimeTools };
            }
            if (serverName === "fetch") {
              return { getTools: mockFetchTools };
            }
            return { getTools: vi.fn().mockResolvedValue([]) };
          },
        },
      ) as McpdClient["servers"];

      const result = await aggregateTools(mockClient);

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("time__get_current_time");
      expect(result[1]?.name).toBe("fetch__fetch_url");
    });

    it("should only include tools from healthy servers", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "unreachable" },
      });

      const mockGetTools = vi.fn().mockResolvedValue([
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: { type: "object", properties: {} },
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: () => ({ getTools: mockGetTools }),
        },
      ) as McpdClient["servers"];

      const result = await aggregateTools(mockClient);

      // Should only have tools from server1.
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("server1__tool1");
    });

    it("should handle Promise.allSettled rejections gracefully", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "ok" },
      });

      const mockServer1Tools = vi.fn().mockResolvedValue([
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: { type: "object", properties: {} },
        },
      ]);
      const mockServer2Tools = vi
        .fn()
        .mockRejectedValue(new Error("Server error"));

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: (_, serverName) => {
            if (serverName === "server1") {
              return { getTools: mockServer1Tools };
            }
            if (serverName === "server2") {
              return { getTools: mockServer2Tools };
            }
            return { getTools: vi.fn().mockResolvedValue([]) };
          },
        },
      ) as McpdClient["servers"];

      const result = await aggregateTools(mockClient);

      // Should only include tools from successful server.
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("server1__tool1");
    });

    it("should preserve tool metadata", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue(["server1"]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
      });

      const mockGetTools = vi.fn().mockResolvedValue([
        {
          name: "complex_tool",
          description: "A complex tool",
          inputSchema: {
            type: "object",
            properties: {
              arg1: { type: "string", description: "First argument" },
              arg2: { type: "number", description: "Second argument" },
            },
            required: ["arg1"],
          },
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: () => ({ getTools: mockGetTools }),
        },
      ) as McpdClient["servers"];

      const result = await aggregateTools(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.description).toBe("A complex tool");
      expect(result[0]?.inputSchema).toEqual({
        type: "object",
        properties: {
          arg1: { type: "string", description: "First argument" },
          arg2: { type: "number", description: "Second argument" },
        },
        required: ["arg1"],
      });
    });
  });

  describe("aggregatePrompts", () => {
    it("should namespace prompt names with server__prompt format", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue(["github", "code"]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        github: { name: "github", status: "ok" },
        code: { name: "code", status: "ok" },
      });

      const mockGithubPrompts = vi.fn().mockResolvedValue([
        {
          name: "create_pr",
          description: "Create a pull request",
          arguments: [{ name: "title", required: true }],
        },
      ]);
      const mockCodePrompts = vi.fn().mockResolvedValue([
        {
          name: "review_code",
          description: "Review code changes",
          arguments: [],
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: (_, serverName) => {
            if (serverName === "github") {
              return { getPrompts: mockGithubPrompts };
            }
            if (serverName === "code") {
              return { getPrompts: mockCodePrompts };
            }
            return { getPrompts: vi.fn().mockResolvedValue([]) };
          },
        },
      ) as McpdClient["servers"];

      const result = await aggregatePrompts(mockClient);

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("github__create_pr");
      expect(result[1]?.name).toBe("code__review_code");
    });

    it("should only include prompts from healthy servers", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "timeout" },
      });

      const mockGetPrompts = vi.fn().mockResolvedValue([
        {
          name: "prompt1",
          description: "Prompt 1",
          arguments: [],
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: () => ({ getPrompts: mockGetPrompts }),
        },
      ) as McpdClient["servers"];

      const result = await aggregatePrompts(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("server1__prompt1");
    });

    it("should handle Promise.allSettled rejections gracefully", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "ok" },
      });

      const mockServer1Prompts = vi.fn().mockResolvedValue([
        {
          name: "prompt1",
          description: "Prompt 1",
          arguments: [],
        },
      ]);
      const mockServer2Prompts = vi
        .fn()
        .mockRejectedValue(new Error("Server error"));

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: (_, serverName) => {
            if (serverName === "server1") {
              return { getPrompts: mockServer1Prompts };
            }
            if (serverName === "server2") {
              return { getPrompts: mockServer2Prompts };
            }
            return { getPrompts: vi.fn().mockResolvedValue([]) };
          },
        },
      ) as McpdClient["servers"];

      const result = await aggregatePrompts(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("server1__prompt1");
    });

    it("should preserve prompt arguments", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue(["server1"]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
      });

      const mockGetPrompts = vi.fn().mockResolvedValue([
        {
          name: "complex_prompt",
          description: "A complex prompt",
          arguments: [
            { name: "arg1", description: "First arg", required: true },
            { name: "arg2", description: "Second arg", required: false },
          ],
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: () => ({ getPrompts: mockGetPrompts }),
        },
      ) as McpdClient["servers"];

      const result = await aggregatePrompts(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.arguments).toEqual([
        { name: "arg1", description: "First arg", required: true },
        { name: "arg2", description: "Second arg", required: false },
      ]);
    });
  });

  describe("aggregateResources", () => {
    it("should namespace resource names and transform URIs to mcpd:// format", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue(["docs", "config"]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        docs: { name: "docs", status: "ok" },
        config: { name: "config", status: "ok" },
      });

      const mockDocsResources = vi.fn().mockResolvedValue([
        {
          uri: "file:///readme.md",
          name: "readme",
          description: "README file",
          mimeType: "text/markdown",
        },
      ]);
      const mockConfigResources = vi.fn().mockResolvedValue([
        {
          uri: "file:///config.json",
          name: "app_config",
          description: "Config file",
          mimeType: "application/json",
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: (_, serverName) => {
            if (serverName === "docs") {
              return { getResources: mockDocsResources };
            }
            if (serverName === "config") {
              return { getResources: mockConfigResources };
            }
            return { getResources: vi.fn().mockResolvedValue([]) };
          },
        },
      ) as McpdClient["servers"];

      const result = await aggregateResources(mockClient);

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("docs__readme");
      expect(result[0]?.uri).toBe("mcpd://docs/file:///readme.md");
      expect(result[1]?.name).toBe("config__app_config");
      expect(result[1]?.uri).toBe("mcpd://config/file:///config.json");
    });

    it("should only include resources from healthy servers", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "unknown" },
      });

      const mockGetResources = vi.fn().mockResolvedValue([
        {
          uri: "file:///test.txt",
          name: "test",
          description: "Test file",
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: () => ({ getResources: mockGetResources }),
        },
      ) as McpdClient["servers"];

      const result = await aggregateResources(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("server1__test");
    });

    it("should handle Promise.allSettled rejections gracefully", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "ok" },
      });

      const mockServer1Resources = vi.fn().mockResolvedValue([
        {
          uri: "file:///test.txt",
          name: "test",
          description: "Test file",
        },
      ]);
      const mockServer2Resources = vi
        .fn()
        .mockRejectedValue(new Error("Server error"));

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: (_, serverName) => {
            if (serverName === "server1") {
              return { getResources: mockServer1Resources };
            }
            if (serverName === "server2") {
              return { getResources: mockServer2Resources };
            }
            return { getResources: vi.fn().mockResolvedValue([]) };
          },
        },
      ) as McpdClient["servers"];

      const result = await aggregateResources(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("server1__test");
    });

    it("should preserve resource metadata", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue(["server1"]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
      });

      const mockGetResources = vi.fn().mockResolvedValue([
        {
          uri: "file:///data.csv",
          name: "dataset",
          description: "Data file with statistics",
          mimeType: "text/csv",
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: () => ({ getResources: mockGetResources }),
        },
      ) as McpdClient["servers"];

      const result = await aggregateResources(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.description).toBe("Data file with statistics");
      expect(result[0]?.mimeType).toBe("text/csv");
      expect(result[0]?._serverName).toBe("server1");
      expect(result[0]?._originalUri).toBe("file:///data.csv");
    });
  });

  describe("aggregateResourceTemplates", () => {
    it("should namespace template names", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue(["files", "web"]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        files: { name: "files", status: "ok" },
        web: { name: "web", status: "ok" },
      });

      const mockFilesTemplates = vi.fn().mockResolvedValue([
        {
          uriTemplate: "file:///{path}",
          name: "file_template",
          description: "File template",
          mimeType: "text/plain",
        },
      ]);
      const mockWebTemplates = vi.fn().mockResolvedValue([
        {
          uriTemplate: "https://{domain}/{path}",
          name: "web_template",
          description: "Web template",
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: (_, serverName) => {
            if (serverName === "files") {
              return { getResourceTemplates: mockFilesTemplates };
            }
            if (serverName === "web") {
              return { getResourceTemplates: mockWebTemplates };
            }
            return { getResourceTemplates: vi.fn().mockResolvedValue([]) };
          },
        },
      ) as McpdClient["servers"];

      const result = await aggregateResourceTemplates(mockClient);

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("files__file_template");
      expect(result[1]?.name).toBe("web__web_template");
    });

    it("should only include templates from healthy servers", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "unreachable" },
      });

      const mockGetResourceTemplates = vi.fn().mockResolvedValue([
        {
          uriTemplate: "file:///{path}",
          name: "template",
          description: "A template",
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: () => ({ getResourceTemplates: mockGetResourceTemplates }),
        },
      ) as McpdClient["servers"];

      const result = await aggregateResourceTemplates(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("server1__template");
    });

    it("should handle Promise.allSettled rejections gracefully", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue([
        "server1",
        "server2",
      ]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "ok" },
      });

      const mockServer1Templates = vi.fn().mockResolvedValue([
        {
          uriTemplate: "file:///{path}",
          name: "template",
          description: "A template",
        },
      ]);
      const mockServer2Templates = vi
        .fn()
        .mockRejectedValue(new Error("Server error"));

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: (_, serverName) => {
            if (serverName === "server1") {
              return { getResourceTemplates: mockServer1Templates };
            }
            if (serverName === "server2") {
              return { getResourceTemplates: mockServer2Templates };
            }
            return { getResourceTemplates: vi.fn().mockResolvedValue([]) };
          },
        },
      ) as McpdClient["servers"];

      const result = await aggregateResourceTemplates(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("server1__template");
    });

    it("should preserve template metadata", async () => {
      vi.mocked(mockClient.listServers).mockResolvedValue(["server1"]);
      vi.mocked<() => Promise<Record<string, ServerHealth>>>(
        mockClient.getServerHealth,
      ).mockResolvedValue({
        server1: { name: "server1", status: "ok" },
      });

      const mockGetResourceTemplates = vi.fn().mockResolvedValue([
        {
          uriTemplate: "file:///{path}",
          name: "file_template",
          description: "Access files by path",
          mimeType: "application/octet-stream",
        },
      ]);

      (mockClient as { servers: unknown }).servers = new Proxy(
        {},
        {
          get: () => ({ getResourceTemplates: mockGetResourceTemplates }),
        },
      ) as McpdClient["servers"];

      const result = await aggregateResourceTemplates(mockClient);

      expect(result).toHaveLength(1);
      expect(result[0]?.description).toBe("Access files by path");
      expect(result[0]?.mimeType).toBe("application/octet-stream");
    });
  });
});
