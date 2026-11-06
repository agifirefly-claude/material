import { afterEach, describe, expect, it } from "vitest";
import { setCatalog, t } from "../../src/ui/i18n";

describe("translation of generic node labels", () => {
  afterEach(() => setCatalog("en", {}));
  it("uses the template with # for an expanded label", () => {
    setCatalog("zh", { "Layer#": "图层#", "Color #": "颜色 #", Layer: "图层" });
    expect(t("Layer2")).toBe("图层2");
    expect(t("Color 12")).toBe("颜色 12");
    expect(t("Layer")).toBe("图层");
    expect(t("Other3")).toBe("Other3");
  });
});
