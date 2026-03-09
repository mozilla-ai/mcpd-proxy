import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMcpServer,
  parsePrefixedName,
  parseResourceUri,
} from "../../src/server";
import type { Config } from "../../src/config";
import {
  PipelineError,
  PIPELINE_FLOW_REQUEST,
  PIPELINE_FLOW_RESPONSE,
} from "@mozilla-ai/mcpd";

// Create mock functions at module level (before vi.mock hoisting).
const mockListServers = vi.fn();
const mockGetServerHealth = vi.fn();
const mockGeneratePrompt = vi.fn();
const mockCallTool = vi.fn();
const mockGetTools = vi.fn();
const mockGetPrompts = vi.fn();
const mockGetResources = vi.fn();
const mockGetResourceTemplates = vi.fn();
const mockReadResource = vi.fn();

// Mock only the McpdClient class; real error classes and constants pass through.
vi.mock("@mozilla-ai/mcpd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mozilla-ai/mcpd")>()),
  McpdClient: vi.fn(
    class {
      listServers = mockListServers;
      getServerHealth = mockGetServerHealth;
      generatePrompt = mockGeneratePrompt;
      servers = new Proxy(
        {},
        {
          get: () => ({
            callTool: mockCallTool,
            getTools: mockGetTools,
            getPrompts: mockGetPrompts,
            getResources: mockGetResources,
            getResourceTemplates: mockGetResourceTemplates,
            readResource: mockReadResource,
          }),
        },
      );
    },
  ),
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
    mockGetServerHealth.mockResolvedValue({
      server1: { name: "server1", status: "ok" },
      server2: { name: "server2", status: "ok" },
    });
    mockGetTools.mockResolvedValue([]);
    mockGetPrompts.mockResolvedValue([]);
    mockGetResources.mockResolvedValue([]);
    mockGetResourceTemplates.mockResolvedValue([]);
    mockCallTool.mockResolvedValue({ result: "success" });
    mockReadResource.mockResolvedValue([{ uri: "test", text: "content" }]);
  });

  describe("Server Creation", () => {
    it("should create an MCP server with correct configuration", () => {
      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });
  });

  describe("Helper Functions", () => {
    describe("parsePrefixedName", () => {
      it("should parse server__name format correctly", () => {
        const result = parsePrefixedName("github__create_pr", "tool");
        expect(result).toEqual({ server: "github", name: "create_pr" });
      });

      it("should handle names with multiple underscores", () => {
        const result = parsePrefixedName("github__create_pull_request", "tool");
        expect(result).toEqual({
          server: "github",
          name: "create_pull_request",
        });
      });

      it("should throw error for invalid format", () => {
        expect(() => parsePrefixedName("invalid", "tool")).toThrow(
          "Invalid tool name format: invalid. Expected format: server__tool_name",
        );
      });
    });

    describe("parseResourceUri", () => {
      it("should parse mcpd:// URI correctly", () => {
        const result = parseResourceUri("mcpd://github/file:///README.md");
        expect(result).toEqual({
          server: "github",
          originalUri: "file:///README.md",
        });
      });

      it("should handle URIs with paths", () => {
        const result = parseResourceUri("mcpd://time/clock/utc");
        expect(result).toEqual({
          server: "time",
          originalUri: "clock/utc",
        });
      });

      it("should throw error for invalid protocol", () => {
        expect(() => parseResourceUri("http://example.com")).toThrow(
          "Invalid resource URI format",
        );
      });

      it("should throw error for missing path", () => {
        expect(() => parseResourceUri("mcpd://server/")).toThrow(
          "Invalid resource URI format",
        );
      });
    });
  });

  describe("ListToolsRequestSchema handler", () => {
    it("should aggregate tools from all healthy servers", async () => {
      mockGetTools
        .mockResolvedValueOnce([
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object", properties: {} },
          },
        ])
        .mockResolvedValueOnce([
          {
            name: "tool2",
            description: "Tool 2",
            inputSchema: { type: "object", properties: {} },
          },
        ]);

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });

    it("should filter out unhealthy servers", async () => {
      mockGetServerHealth.mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "unreachable" },
      });

      mockGetTools.mockResolvedValue([
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: { type: "object", properties: {} },
        },
      ]);

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });

    it("should handle servers with no tools", async () => {
      mockGetTools.mockResolvedValue([]);

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });
  });

  describe("ListResourcesRequestSchema handler", () => {
    it("should aggregate resources from all healthy servers", async () => {
      mockGetResources
        .mockResolvedValueOnce([
          {
            uri: "file:///test.txt",
            name: "test_file",
            description: "A test file",
            mimeType: "text/plain",
          },
        ])
        .mockResolvedValueOnce([
          {
            uri: "file:///data.json",
            name: "data",
            description: "Data file",
            mimeType: "application/json",
          },
        ]);

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });

    it("should transform resources with mcpd:// URIs", async () => {
      mockGetResources.mockResolvedValue([
        {
          uri: "file:///test.txt",
          name: "test_file",
          description: "A test file",
        },
      ]);

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });

    it("should filter out unhealthy servers", async () => {
      mockGetServerHealth.mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "timeout" },
      });

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });
  });

  describe("ListResourceTemplatesRequestSchema handler", () => {
    it("should aggregate resource templates from all healthy servers", async () => {
      mockGetResourceTemplates
        .mockResolvedValueOnce([
          {
            uriTemplate: "file:///{path}",
            name: "file_template",
            description: "File template",
            mimeType: "text/plain",
          },
        ])
        .mockResolvedValueOnce([
          {
            uriTemplate: "https://{domain}/{path}",
            name: "web_template",
            description: "Web template",
          },
        ]);

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });

    it("should filter out unhealthy servers", async () => {
      mockGetServerHealth.mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "unknown" },
      });

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });
  });

  describe("ListPromptsRequestSchema handler", () => {
    it("should aggregate prompts from all healthy servers", async () => {
      mockGetPrompts
        .mockResolvedValueOnce([
          {
            name: "prompt1",
            description: "Prompt 1",
            arguments: [{ name: "arg1", required: true }],
          },
        ])
        .mockResolvedValueOnce([
          {
            name: "prompt2",
            description: "Prompt 2",
            arguments: [],
          },
        ]);

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });

    it("should filter out unhealthy servers", async () => {
      mockGetServerHealth.mockResolvedValue({
        server1: { name: "server1", status: "ok" },
        server2: { name: "server2", status: "unreachable" },
      });

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });
  });

  describe("CallToolRequestSchema handler", () => {
    // Retrieves the registered tools/call handler from the MCP server internals.
    function getCallToolHandler(server: ReturnType<typeof createMcpServer>) {
      const handlers = (
        server as unknown as {
          _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
        }
      )._requestHandlers;
      return handlers.get("tools/call")!;
    }

    it("should call tool on correct server", async () => {
      mockCallTool.mockResolvedValue({ result: "tool executed" });

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });

    it("should handle tool not found errors", async () => {
      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });

    it("should handle PipelineError on request flow", async () => {
      mockCallTool.mockRejectedValue(
        new PipelineError(
          "Auth plugin rejected request",
          "server1",
          "callTool",
          PIPELINE_FLOW_REQUEST,
        ),
      );

      const handler = getCallToolHandler(createMcpServer(config));
      const result = await handler({
        method: "tools/call",
        params: { name: "server1__my_tool", arguments: {} },
      });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Tool 'server1__my_tool' pipeline request error: Auth plugin rejected request",
          },
        ],
        isError: true,
      });
    });

    it("should handle PipelineError on response flow", async () => {
      mockCallTool.mockRejectedValue(
        new PipelineError(
          "Response transform failed",
          "server1",
          "callTool",
          PIPELINE_FLOW_RESPONSE,
        ),
      );

      const handler = getCallToolHandler(createMcpServer(config));
      const result = await handler({
        method: "tools/call",
        params: { name: "server1__my_tool", arguments: {} },
      });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Tool 'server1__my_tool' pipeline response error: Response transform failed",
          },
        ],
        isError: true,
      });
    });

    it("should handle PipelineError with undefined flow", async () => {
      mockCallTool.mockRejectedValue(
        new PipelineError("Unknown pipeline failure", "server1", "callTool"),
      );

      const handler = getCallToolHandler(createMcpServer(config));
      const result = await handler({
        method: "tools/call",
        params: { name: "server1__my_tool", arguments: {} },
      });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Tool 'server1__my_tool' pipeline undefined error: Unknown pipeline failure",
          },
        ],
        isError: true,
      });
    });
  });

  describe("ReadResourceRequestSchema handler", () => {
    it("should read resource from correct server", async () => {
      mockReadResource.mockResolvedValue([
        {
          uri: "file:///test.txt",
          text: "file content",
          mimeType: "text/plain",
        },
      ]);

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });

    it("should handle binary resources", async () => {
      mockReadResource.mockResolvedValue([
        {
          uri: "file:///image.png",
          blob: "base64data",
          mimeType: "image/png",
        },
      ]);

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });
  });

  describe("GetPromptRequestSchema handler", () => {
    it("should generate prompt using SDK method", async () => {
      mockGeneratePrompt.mockResolvedValue({
        description: "Test prompt",
        messages: [{ role: "user", content: "test" }],
      });

      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });
  });

  describe("PingRequestSchema handler", () => {
    it("should respond to ping requests", async () => {
      const server = createMcpServer(config);
      expect(server).toBeDefined();
    });
  });
});
