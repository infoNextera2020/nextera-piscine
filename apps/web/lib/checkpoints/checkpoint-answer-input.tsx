'use client';
import { useState } from 'react';
import { HairlineIcon } from '../../components/learning/hairline-icon';
import { serializeMixedAnswer, type MixedCheckpointAnswer } from './checkpoint-answer';
import e from './checkpoint-editor.module.css';

export function CheckpointAnswerInput({
  taskKey,
  title,
  filename,
  answer,
  maxBytes,
  readOnly,
  onChange,
}: {
  taskKey: string;
  title: string;
  filename?: string | undefined;
  answer: MixedCheckpointAnswer;
  maxBytes: number;
  readOnly: boolean;
  onChange(answer: MixedCheckpointAnswer): void;
}) {
  const [checked, setChecked] = useState(false);
  let invalid = false;
  try {
    serializeMixedAnswer(answer, maxBytes);
  } catch {
    invalid = true;
  }
  const trace = answer.kind === 'trace_with_reason';
  const help = 'checkpoint-mixed-help-' + taskKey;
  const error = 'checkpoint-mixed-error-' + taskKey;
  const description = 'checkpoint-mixed-status ' + help + (checked && invalid ? ' ' + error : '');
  return (
    <div className={e.editorFrame}>
      <div className={e.editorHeader}>
        <HairlineIcon name="code" size={28} />
        <span>{trace ? 'Trace response' : (filename ?? 'Corrected function')}</span>
        <span>{trace ? 'Exact output + reason' : 'Go + explanation'}</span>
      </div>
      <fieldset className={e.answerFields}>
        <legend>
          {trace ? 'Trace answer' : 'Debugging answer'} for {title}
        </legend>
        {answer.kind === 'trace_with_reason' ? (
          <>
            <label htmlFor={'checkpoint-output-' + taskKey}>Exact output</label>
            <textarea
              id={'checkpoint-output-' + taskKey}
              name="output"
              className={e.answerOutput}
              value={answer.output}
              onChange={(event) => onChange({ ...answer, output: event.target.value })}
              onBlur={() => setChecked(true)}
              readOnly={readOnly}
              aria-describedby={description}
              aria-invalid={(checked && invalid) || undefined}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              wrap="off"
              rows={6}
            />
            <label htmlFor={'checkpoint-reason-' + taskKey}>Brief reason</label>
            <textarea
              id={'checkpoint-reason-' + taskKey}
              name="reason"
              className={e.answerText}
              value={answer.reason}
              onChange={(event) => onChange({ ...answer, reason: event.target.value })}
              onBlur={() => setChecked(true)}
              readOnly={readOnly}
              aria-describedby={description}
              aria-invalid={(checked && invalid) || undefined}
              autoComplete="off"
              rows={4}
            />
          </>
        ) : (
          <>
            <label htmlFor={'checkpoint-debug-' + taskKey}>Corrected function</label>
            <textarea
              id={'checkpoint-debug-' + taskKey}
              name="source"
              className={e.answerOutput}
              value={answer.source}
              onChange={(event) => onChange({ ...answer, source: event.target.value })}
              onBlur={() => setChecked(true)}
              readOnly={readOnly}
              aria-describedby={description}
              aria-invalid={(checked && invalid) || undefined}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              wrap="off"
              rows={12}
            />
            <label htmlFor={'checkpoint-explanation-' + taskKey}>Explanation of the fix</label>
            <textarea
              id={'checkpoint-explanation-' + taskKey}
              name="explanation"
              className={e.answerText}
              value={answer.explanation}
              onChange={(event) => onChange({ ...answer, explanation: event.target.value })}
              onBlur={() => setChecked(true)}
              readOnly={readOnly}
              aria-describedby={description}
              aria-invalid={(checked && invalid) || undefined}
              autoComplete="off"
              rows={4}
            />
            <label htmlFor={'checkpoint-counterexample-' + taskKey}>
              Counterexample and expected result
            </label>
            <textarea
              id={'checkpoint-counterexample-' + taskKey}
              name="counterexample"
              className={e.answerText}
              value={answer.counterexample}
              onChange={(event) => onChange({ ...answer, counterexample: event.target.value })}
              onBlur={() => setChecked(true)}
              readOnly={readOnly}
              aria-describedby={description}
              aria-invalid={(checked && invalid) || undefined}
              autoComplete="off"
              rows={4}
            />
          </>
        )}
        <p id={help} className={e.answerHelp}>
          {trace
            ? 'Keep output line breaks and spacing exact. Explain the result in the reason field.'
            : 'Keep the published function contract. Include an explanation and a small input with its expected result.'}
        </p>
        {checked && invalid && (
          <p id={error} className={e.notice} role="alert">
            This answer contains invalid text or exceeds the published response size. Keep a valid
            UTF-8 response within the stated limit.
          </p>
        )}
      </fieldset>
      <div className={e.editorFooter}>
        <span>{trace ? 'Text response' : 'Debugging response'}</span>
        <span>Draft / not submitted</span>
      </div>
    </div>
  );
}
