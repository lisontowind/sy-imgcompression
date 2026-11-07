// @vitest-environment jsdom
import { expect, it } from "vitest";
import { documentSourceInventory } from "../src/core/document-source";
const id = "20261016000000-abcdefg";
it("reads current source order, HTML-escaped title images and folded content", () => {
  const source = documentSourceInventory({ ID: id, Type: "NodeDocument", Properties: {
    title: "项目实施方案验收记录", "title-img": 'background-image:url(&quot;assets/%E5%9B%BE.png&quot;)',
  }, Children: [
    { Type: "NodeParagraph", Properties: { fold: "1" }, Children: [{ Type: "NodeLinkDest", Data: "assets/second.png" }] },
    { Type: "NodeTextMark", TextMarkType: "a", TextMarkAHref: "assets/file.pdf?x=1#page" },
  ] }, id);
  expect(source.paths).toEqual(["assets/图.png", "assets/second.png", "assets/file.pdf"]);
  expect(source.title).toBe("项目实施方案验收记录");
});
it("does not follow block references or interpret ordinary text as a resource", () => {
  expect(documentSourceInventory({ ID: id, Type: "NodeDocument", Children: [{ Type: "NodeText", Data: "assets/not-a-link.png" }, { Type: "NodeBlockRef", Data: "another-doc" }] }, id).paths).toEqual([]);
});
it("includes annotation-only PDFs, document attributes and HTML attachment attributes", () => {
  expect(documentSourceInventory({ ID: id, Type: "NodeDocument", Properties: { "custom-data-assets": "assets/root.png" }, Children: [
    { Type: "NodeFileAnnotationRefID", Data: "assets/first.pdf/20261016000001-abcdefg" },
    { Type: "NodeTextMark", TextMarkType: "file-annotation-ref", TextMarkFileAnnotationRefID: "assets/second.pdf/20261016000002-abcdefg" },
    { Type: "NodeHTMLBlock", Data: '<div custom-asset="assets/html.png"></div>' },
  ] }, id).paths).toEqual(["assets/root.png", "assets/first.pdf", "assets/second.pdf", "assets/html.png"]);
});
