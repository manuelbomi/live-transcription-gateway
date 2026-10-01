export interface RecordButtonProps {
  isRecording: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function RecordButton({ isRecording, onClick, disabled }: RecordButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={isRecording ? "record-button recording" : "record-button"}
    >
      {isRecording ? "Stop" : "Record"}
    </button>
  );
}
