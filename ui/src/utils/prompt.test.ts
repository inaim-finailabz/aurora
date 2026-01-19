import { describe, it, expect } from "vitest";
import { cleanImprovedPrompt } from "./prompt";

describe("cleanImprovedPrompt", () => {
  it("extracts content from fenced code block", () => {
    const input = "```\nThis is the prompt\n```";
    expect(cleanImprovedPrompt(input)).toBe("This is the prompt");
  });

  it("removes surrounding quotes", () => {
    const input = '"A clean prompt"';
    expect(cleanImprovedPrompt(input)).toBe("A clean prompt");
  });

  it("strips leading labels", () => {
    const input = "Improved prompt: Please summarize the text.";
    expect(cleanImprovedPrompt(input)).toBe("Please summarize the text.");
  });

  it("turns bullets into plain lines", () => {
    const input = "- Do this\n- Do that";
    expect(cleanImprovedPrompt(input)).toBe("Do this\nDo that");
  });

  it("turns numbered list into plain lines", () => {
    const input = "1. Step one\n2. Step two";
    expect(cleanImprovedPrompt(input)).toBe("Step one\nStep two");
  });

  it("removes trailing explanation sections", () => {
    const input = "Make it concise.\n\nExplanation: This is why.";
    expect(cleanImprovedPrompt(input)).toBe("Make it concise.");
  });

  it("keeps multiline prompts when not an explanation", () => {
    const input = "First line.\nSecond line.";
    expect(cleanImprovedPrompt(input)).toBe("First line.\nSecond line.");
  });
});
