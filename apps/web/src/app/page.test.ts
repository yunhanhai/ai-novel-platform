import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Page from "./page";

describe("landing page", () => {
  it("renders the product name", () => {
    const renderedText = renderToStaticMarkup(createElement(Page));

    expect(renderedText).toContain("AI Novel Platform");
  });
});
