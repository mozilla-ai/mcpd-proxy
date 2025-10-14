import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should load default configuration", () => {
    delete process.env.MCPD_ADDR;
    delete process.env.MCPD_API_KEY;

    const config = loadConfig();

    expect(config.mcpdAddr).toBe("http://localhost:8090");
    expect(config.mcpdApiKey).toBeUndefined();
  });

  it("should load MCPD_ADDR from environment", () => {
    process.env.MCPD_ADDR = "http://example.com:9000";
    delete process.env.MCPD_API_KEY;

    const config = loadConfig();

    expect(config.mcpdAddr).toBe("http://example.com:9000");
    expect(config.mcpdApiKey).toBeUndefined();
  });

  it("should load MCPD_API_KEY from environment", () => {
    delete process.env.MCPD_ADDR;
    process.env.MCPD_API_KEY = "test-api-key";

    const config = loadConfig();

    expect(config.mcpdAddr).toBe("http://localhost:8090");
    expect(config.mcpdApiKey).toBe("test-api-key");
  });

  it("should load both values from environment", () => {
    process.env.MCPD_ADDR = "http://production:8080";
    process.env.MCPD_API_KEY = "production-key";

    const config = loadConfig();

    expect(config.mcpdAddr).toBe("http://production:8080");
    expect(config.mcpdApiKey).toBe("production-key");
  });

  it("should handle empty string API key", () => {
    process.env.MCPD_API_KEY = "";

    const config = loadConfig();

    expect(config.mcpdApiKey).toBe("");
  });
});
