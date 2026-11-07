import { describe,expect,it } from "vitest";
import { parseQualityConstraints,checkQualityConstraints } from "./quality-constraints";

describe("explicit chapter quality constraints",()=>{
  it("counts codepoints consistently and reports exact missing phrases",()=>{
    const rules=parseQualityConstraints({minChars:3,maxChars:5,requiredFacts:["死亡预告","死亡预告"]})!;
    expect(checkQualityConstraints("甲😀 乙",rules)).toEqual({passed:false,charCount:3,minChars:3,maxChars:5,lengthPassed:true,missingFacts:["死亡预告"]});
    expect(checkQualityConstraints("死亡预告。",rules).passed).toBe(true);
  });
  it.each([{minChars:900,maxChars:700},{minChars:-1},{maxChars:30000},{requiredFacts:[42]},{requiredFacts:["a".repeat(101)]}])("rejects invalid constraints: %j",value=>{
    expect(()=>parseQualityConstraints(value)).toThrow();
  });
  it("keeps unconstrained historical jobs unchanged",()=>{
    expect(parseQualityConstraints(undefined)).toBeUndefined();
  });
});
