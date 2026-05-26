import React from 'react';
import './StepIndicator.css';

const STEPS = [
  { key: 'upload', label: 'Upload' },
  { key: 'gl-selection', label: 'GL Accounts' },
  { key: 'review', label: 'Review & Post' },
  { key: 'summary', label: 'Summary' },
];

export default function StepIndicator({ current }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <div className="step-indicator">
      {STEPS.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <React.Fragment key={step.key}>
            <div className={`step ${active ? 'step-active' : ''} ${done ? 'step-done' : ''}`}>
              <div className="step-circle">
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <span className="step-label">{step.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`step-line ${idx < currentIdx ? 'step-line-done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
