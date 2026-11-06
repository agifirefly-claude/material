import { describe, expect, it } from "vitest";
import { evaluateExpression } from "../../src/engine/expression";

describe("evaluateExpression", () => {
  it("does arithmetic and functions", () => {
    expect(evaluateExpression("1+2*3")).toBe(7);
    expect(evaluateExpression("-(2**3)/4")).toBe(-2);
    expect(evaluateExpression("max(1, $a)", { a: 5 })).toBe(5);
  });
  it("does logic the way export conditions use it", () => {
    expect(evaluateExpression("true or false")).toBe(1);
    expect(evaluateExpression("true and false")).toBe(0);
    expect(evaluateExpression("not false and 2 > 1")).toBe(1);
    expect(evaluateExpression("false or false or true")).toBe(1);
    expect(evaluateExpression('"Godot" == "Godot"')).toBe(1);
  });
  it("rejects anything else", () => {
    expect(evaluateExpression("alert(1)")).toBeUndefined();
    expect(evaluateExpression("1 +")).toBeUndefined();
  });
});
