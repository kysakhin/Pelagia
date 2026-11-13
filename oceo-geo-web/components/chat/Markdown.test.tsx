import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "./Markdown";

const render = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>);

describe("Markdown", () => {
  it("renders the summary agent's bullet + bold format", () => {
    const html = render(
      "Both profiles show a very similar structure:\n" +
        "* **Surface (0 dbar):** Warm, around 24.5°C.\n" +
        "* **Upper thermocline (50-200 dbar):** Sharp decrease.",
    );
    expect(html).toContain("<ul");
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain("Surface (0 dbar):</strong>");
    expect(html).not.toContain("**");
  });

  it("renders GFM tables", () => {
    const html = render("| Profile | Depth |\n|---|---|\n| 2211 | 1649.9 |");
    expect(html).toContain("<table");
    expect(html).toContain("<td");
    expect(html).toContain("1649.9");
  });

  it("does not render raw HTML from model output", () => {
    const html = render('<img src=x onerror="alert(1)"> hi');
    expect(html).not.toContain("<img");
  });
});
