import type { CvStatus } from '@cv-builder/shared';

const LABELS: Record<CvStatus, string> = {
  draft: 'Draft',
  generating: 'Generating',
  failed: 'Failed',
  ready: 'Ready',
};

/** A CV's status as a chip. Status chips are labels, never buttons. */
export function StatusChip({ status, className }: { status: CvStatus; className?: string }) {
  return (
    <span className={`chip chip-${status}${className ? ` ${className}` : ''}`}>
      {LABELS[status]}
    </span>
  );
}
