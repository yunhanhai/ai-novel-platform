interface WizardStepperProps {
  steps: ReadonlyArray<string>;
  current: number;
}

export function WizardStepper({ steps, current }: WizardStepperProps) {
  return (
    <ol className="wizard-stepper" aria-label="向导步骤">
      {steps.map((label, idx) => {
        const state =
          idx < current ? "done" : idx === current ? "current" : "upcoming";
        return (
          <li key={label} className={`wizard-step wizard-step-${state}`}>
            <span className="wizard-step-index" aria-hidden>
              {idx + 1}
            </span>
            <span className="wizard-step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
