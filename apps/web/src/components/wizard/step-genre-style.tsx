"use client";

import {
  GENRE_OPTIONS,
  STYLE_OPTIONS,
  getMethodologyOptions,
  METHODOLOGY_NONE,
  type MethodologyOption
} from "../../lib/wizard-options";
import { OptionCards } from "./option-cards";

interface StepGenreStyleProps {
  genreTags: string[];
  styleTags: string[];
  methodology: MethodologyOption["value"];
  onChange: (patch: {
    genreTags?: string[];
    styleTags?: string[];
    methodology?: MethodologyOption["value"];
  }) => void;
}

export function StepGenreStyle({
  genreTags,
  styleTags,
  methodology,
  onChange
}: StepGenreStyleProps) {
  const methodologyOptions = getMethodologyOptions();

  return (
    <div className="wizard-step-body">
      <h2 className="wizard-step-title">题材 · 风格 · 方法论</h2>
      <p className="muted wizard-step-hint">
        全部都是选择题，可以多选，也可以全部跳过
      </p>

      <div className="wizard-field">
        <span>题材（可多选）</span>
        <OptionCards
          mode="multi"
          ariaLabel="题材"
          options={GENRE_OPTIONS}
          value={genreTags}
          onChange={(next) => onChange({ genreTags: next })}
        />
      </div>

      <div className="wizard-field">
        <span>叙事风格（可多选）</span>
        <OptionCards
          mode="multi"
          ariaLabel="叙事风格"
          options={STYLE_OPTIONS}
          value={styleTags}
          onChange={(next) => onChange({ styleTags: next })}
        />
      </div>

      <div className="wizard-field">
        <span>写作方法论（单选）</span>
        <OptionCards
          mode="single"
          ariaLabel="写作方法论"
          options={methodologyOptions}
          value={methodology}
          onChange={(next) => onChange({ methodology: next ?? METHODOLOGY_NONE })}
        />
        <small className="muted">
          方法论决定大纲骨架与章节审查规则。选中后会落库为项目方法论占位，可随时在工作台修改。
        </small>
      </div>
    </div>
  );
}
