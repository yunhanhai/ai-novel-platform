"use client";

import { useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { WizardStepper } from "../../../../components/wizard/wizard-stepper";
import { StepBasics } from "../../../../components/wizard/step-basics";
import { StepGenreStyle } from "../../../../components/wizard/step-genre-style";
import {
  joinTags,
  METHODOLOGY_NONE,
  type ProjectType
} from "../../../../lib/wizard-options";
import type { MethodType } from "@ai-novel/shared/methodology/templates";

type MethodologyValue = MethodType | typeof METHODOLOGY_NONE;

interface WizardState {
  step: 0 | 1;
  title: string;
  slug: string;
  type: ProjectType;
  genreTags: string[];
  styleTags: string[];
  methodology: MethodologyValue;
}

const STEPS = ["基础信息", "题材风格"] as const;

const initialState: WizardState = {
  step: 0,
  title: "",
  slug: "",
  type: "LONG_NOVEL",
  genreTags: [],
  styleTags: [],
  methodology: METHODOLOGY_NONE
};

type Action =
  | { type: "patch"; patch: Partial<WizardState> }
  | { type: "next" }
  | { type: "prev" };

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch };
    case "next":
      return state.step >= STEPS.length - 1
        ? state
        : { ...state, step: (state.step + 1) as WizardState["step"] };
    case "prev":
      return state.step <= 0
        ? state
        : { ...state, step: (state.step - 1) as WizardState["step"] };
    default:
      return state;
  }
}

function canAdvance(state: WizardState): boolean {
  if (state.step === 0) {
    return state.title.trim().length > 0 && /^[a-z0-9-]+$/.test(state.slug);
  }
  return true;
}

export default function NewProjectPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!canAdvance({ ...state, step: 0 })) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        title: state.title.trim(),
        slug: state.slug.trim(),
        type: state.type,
        ...(state.genreTags.length > 0 ? { genre: joinTags(state.genreTags) } : {}),
        ...(state.styleTags.length > 0
          ? { styleBrief: joinTags(state.styleTags) }
          : {}),
        ...(state.methodology !== METHODOLOGY_NONE
          ? { wizard: { methodType: state.methodology } }
          : {})
      };
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = (await res.json()) as {
        success: boolean;
        data?: { id: string };
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? `创建失败 (${res.status})`);
      }
      router.push(`/projects/${json.data.id}/workspace`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建失败");
      setSubmitting(false);
    }
  }

  const isLastStep = state.step === STEPS.length - 1;

  return (
    <div className="projects-page wizard-page">
      <div className="page-header">
        <h1>新建作品</h1>
      </div>

      <WizardStepper steps={STEPS} current={state.step} />

      <div className="wizard-content">
        {state.step === 0 && (
          <StepBasics
            title={state.title}
            slug={state.slug}
            type={state.type}
            onChange={(patch) => dispatch({ type: "patch", patch })}
          />
        )}
        {state.step === 1 && (
          <StepGenreStyle
            genreTags={state.genreTags}
            styleTags={state.styleTags}
            methodology={state.methodology}
            onChange={(patch) => dispatch({ type: "patch", patch })}
          />
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="wizard-footer">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => dispatch({ type: "prev" })}
          disabled={state.step === 0 || submitting}
        >
          上一步
        </button>
        {!isLastStep ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => dispatch({ type: "next" })}
            disabled={!canAdvance(state)}
          >
            下一步
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSubmit()}
            disabled={submitting || !canAdvance({ ...state, step: 0 })}
          >
            {submitting ? "创建中..." : "创建"}
          </button>
        )}
      </div>
    </div>
  );
}
