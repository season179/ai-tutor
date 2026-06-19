import type { FormEvent } from "react";

import { ActionButton } from "./ActionButton.js";
import { Panel } from "./Panel.js";

type ProblemContextPanelProps = {
  emptyMessage: string;
  extractionStatusHint: string | null;
  imageMeta: string;
  imagePrompt: string;
  isBusy: boolean;
  onFileChange: (file: File | undefined) => void;
  onPromptChange: (value: string) => void;
  onReExtract: () => void | Promise<void>;
  onSubmit: () => void | Promise<void>;
  previewUrl: string | undefined;
  reExtractDisabled: boolean;
  sendDisabled: boolean;
};

export function ProblemContextPanel({
  emptyMessage,
  extractionStatusHint,
  imageMeta,
  imagePrompt,
  isBusy,
  onFileChange,
  onPromptChange,
  onReExtract,
  onSubmit,
  previewUrl,
  reExtractDisabled,
  sendDisabled
}: ProblemContextPanelProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit();
  };

  return (
    <Panel
      className="problem-panel"
      description="Add the page or prompt the tutor should reason from."
      id="problem-title"
      title="Problem context"
    >
      <div className="workflow-step">
        <p className="workflow-step-label">Step 1 · Confirm the question</p>
        <p className="workflow-step-description">
          Upload a photo of the problem. We&apos;ll read the question so you can check it before tutoring.
        </p>
      </div>

      <form className="image-form" onSubmit={handleSubmit}>
        <label className="field file-field">
          <span>Problem image</span>
          <input
            accept="image/*"
            disabled={isBusy}
            type="file"
            onChange={(event) => onFileChange(event.target.files?.item(0) ?? undefined)}
          />
        </label>

        <div className="image-grid">
          <label className="field question-field">
            <span>Question</span>
            {extractionStatusHint ? (
              <p className="extraction-status" aria-live="polite">
                {extractionStatusHint}
              </p>
            ) : null}
            <textarea
              disabled={isBusy}
              rows={5}
              value={imagePrompt}
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </label>

          <div className="image-preview-block" aria-live="polite">
            <div className="image-preview">
              {previewUrl ? (
                <img alt="Problem image preview" src={previewUrl} />
              ) : (
                <p>{emptyMessage}</p>
              )}
            </div>
            <p className="image-meta">{imageMeta}</p>
          </div>
        </div>

        <div className="form-actions">
          <ActionButton
            disabled={reExtractDisabled}
            type="button"
            variant="secondary"
            onClick={() => {
              void onReExtract();
            }}
          >
            Re-extract
          </ActionButton>

          <ActionButton
            className="send-action later-step-action"
            disabled={sendDisabled}
            icon="send"
            type="submit"
            variant="secondary"
          >
            Ask about image
          </ActionButton>
        </div>
      </form>
    </Panel>
  );
}
