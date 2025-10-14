import { describe, it, expect } from "vitest";
import { API_PATHS } from "../../src/apiPaths";

describe("API_PATHS", () => {
  describe("HEALTH_SERVERS", () => {
    it("should return correct health servers endpoint", () => {
      expect(API_PATHS.HEALTH_SERVERS).toBe("/api/v1/health/servers");
    });
  });

  describe("SERVER_RESOURCES", () => {
    it("should return correct server resources endpoint", () => {
      const result = API_PATHS.SERVER_RESOURCES("time");
      expect(result).toBe("/api/v1/servers/time/resources");
    });

    it("should encode server names with special characters", () => {
      const result = API_PATHS.SERVER_RESOURCES("my server");
      expect(result).toBe("/api/v1/servers/my%20server/resources");
    });

    it("should encode server names with special URL characters", () => {
      const result = API_PATHS.SERVER_RESOURCES("server/test");
      expect(result).toBe("/api/v1/servers/server%2Ftest/resources");
    });
  });

  describe("RESOURCE_CONTENT", () => {
    it("should return correct resource content endpoint", () => {
      const result = API_PATHS.RESOURCE_CONTENT("time", "clock/utc");
      expect(result).toBe(
        "/api/v1/servers/time/resources/content?uri=clock%2Futc",
      );
    });

    it("should encode both server name and URI", () => {
      const result = API_PATHS.RESOURCE_CONTENT(
        "my server",
        "path/to/resource",
      );
      expect(result).toBe(
        "/api/v1/servers/my%20server/resources/content?uri=path%2Fto%2Fresource",
      );
    });

    it("should handle URIs with special characters", () => {
      const result = API_PATHS.RESOURCE_CONTENT("fs", "file with spaces.txt");
      expect(result).toBe(
        "/api/v1/servers/fs/resources/content?uri=file%20with%20spaces.txt",
      );
    });
  });

  describe("SERVER_PROMPTS", () => {
    it("should return correct server prompts endpoint", () => {
      const result = API_PATHS.SERVER_PROMPTS("github");
      expect(result).toBe("/api/v1/servers/github/prompts");
    });

    it("should encode server names with special characters", () => {
      const result = API_PATHS.SERVER_PROMPTS("my-server");
      expect(result).toBe("/api/v1/servers/my-server/prompts");
    });
  });

  describe("PROMPT_GET", () => {
    it("should return correct prompt get endpoint", () => {
      const result = API_PATHS.PROMPT_GET("github", "create_issue");
      expect(result).toBe("/api/v1/servers/github/prompts/create_issue");
    });

    it("should encode both server name and prompt name", () => {
      const result = API_PATHS.PROMPT_GET("my server", "my prompt");
      expect(result).toBe("/api/v1/servers/my%20server/prompts/my%20prompt");
    });

    it("should handle prompt names with special characters", () => {
      const result = API_PATHS.PROMPT_GET("ai", "prompt/test");
      expect(result).toBe("/api/v1/servers/ai/prompts/prompt%2Ftest");
    });
  });
});
