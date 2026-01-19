export function cleanImprovedPrompt(text: string): string {
  let s = (text || "").trim();

  // If the model returned a fenced block, extract the inner content
  const tripleMatch = s.match(/```(?:\w*\n)?([\s\S]*?)```/);
  if (tripleMatch) s = tripleMatch[1].trim();

  // Remove surrounding quotes if present
  const quoteMatch = s.match(/^(["'“”‘’])([\s\S]+)\1$/);
  if (quoteMatch) s = quoteMatch[2].trim();

  // Remove common leading labels and blank lines
  const lines = s.split(/\r?\n/).map((l) => l.trim());
  let start = 0;
  while (
    start < lines.length &&
    (
      /^(improved prompt|here'?s an? improved prompt|suggested prompt|suggested|prompt|improved)\s*[:\-]?\s*$/i.test(lines[start]) ||
      lines[start] === ""
    )
  ) {
    start++;
  }
  let candidate = lines.slice(start).join("\n").trim();

  // If there is an explanation header, strip everything after it
  const explanationIndex = candidate.search(/(^|\n)\s*(explanation|notes?|why)\b[:\-]?/i);
  if (explanationIndex !== -1) {
    candidate = candidate.substring(0, explanationIndex).trim();
  }

  // Remove leading list markers if lines are predominantly list items
  const candidateLines = candidate.split(/\r?\n/).map((l) => l.trim());
  const listyCount = candidateLines.filter((l) => /^([*\-+]|\d+\.)\s+/.test(l)).length;
  if (listyCount >= candidateLines.length && listyCount > 0) {
    candidate = candidateLines.map((l) => l.replace(/^([*\-+]|\d+\.)\s+/, "")).join("\n");
  }

  // Remove any leading label-like fragments (e.g., "Improved:")
  candidate = candidate.replace(/^[^:\n]+:\s*/, "");

  // Trim trailing and leading whitespace and return
  return candidate.trim();
}
