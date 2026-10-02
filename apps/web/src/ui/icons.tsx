import type { SVGProps } from 'react';

/** Inline stroke icons from the CV Builder design. Decorative: always aria-hidden. */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function BrandMarkIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" {...props}>
      <path
        d="M3.5 1.75H8.1L10.75 4.4V11.25C10.75 11.8 10.3 12.25 9.75 12.25H3.5C2.95 12.25 2.5 11.8 2.5 11.25V2.75C2.5 2.2 2.95 1.75 3.5 1.75Z"
        fill="#FFFFFF"
      />
      <path
        d="M8.1 1.75V3.9C8.1 4.17 8.33 4.4 8.6 4.4H10.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeOpacity="0.4"
      />
      <path d="M4.6 7.1H8.6M4.6 9.4H7.1" {...stroke} strokeWidth="1.15" />
    </svg>
  );
}

export function PlusIcon({ size = 16, ...props }: IconProps & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="M8 3.25V12.75M3.25 8H12.75" {...stroke} strokeWidth="1.75" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" {...props}>
      <path d="M3 7H11M7.75 3.75L11 7L7.75 10.25" {...stroke} strokeWidth="1.5" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" {...props}>
      <path d="M11 7H3M6.25 3.75L3 7L6.25 10.25" {...stroke} strokeWidth="1.5" />
    </svg>
  );
}

export function RetryIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="M13.25 8A5.25 5.25 0 1 1 11.7 4.3" {...stroke} strokeWidth="1.6" />
      <path d="M12.25 1.75V4.75H9.25" {...stroke} strokeWidth="1.6" />
    </svg>
  );
}

/** Large alert used by page-level error panels. */
export function AlertCircleIcon(props: IconProps) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8.75" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.5V12.75" {...stroke} strokeWidth="1.9" />
      <circle cx="12" cy="16.1" r="1.15" fill="currentColor" />
    </svg>
  );
}

/** A page with a question mark, for "page not found". */
export function MissingPageIcon(props: IconProps) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        d="M7.5 3.75H13.4L17.75 8.1V18.5C17.75 19.47 16.97 20.25 16 20.25H7.5C6.53 20.25 5.75 19.47 5.75 18.5V5.5C5.75 4.53 6.53 3.75 7.5 3.75Z"
        {...stroke}
        strokeWidth="1.6"
      />
      <path d="M13.25 3.9V7.25C13.25 7.8 13.7 8.25 14.25 8.25H17.6" {...stroke} strokeWidth="1.6" />
      <path
        d="M9.9 11.7C10.05 10.85 10.9 10.25 11.85 10.3C12.85 10.35 13.55 11.05 13.45 11.95C13.35 12.85 12.25 13.15 11.85 13.9V14.3"
        {...stroke}
        strokeWidth="1.6"
      />
      <circle cx="11.85" cy="16.6" r="1" fill="currentColor" />
    </svg>
  );
}

export function BriefcaseIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path
        d="M2.75 6.25C2.75 5.56 3.31 5 4 5H12C12.69 5 13.25 5.56 13.25 6.25V12C13.25 12.69 12.69 13.25 12 13.25H4C3.31 13.25 2.75 12.69 2.75 12V6.25Z"
        {...stroke}
        strokeWidth="1.4"
      />
      <path
        d="M6 5V4C6 3.31 6.56 2.75 7.25 2.75H8.75C9.44 2.75 10 3.31 10 4V5M2.75 8.75H13.25"
        {...stroke}
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" {...props}>
      <path d="M4 4L10 10M10 4L4 10" {...stroke} strokeWidth="1.6" />
    </svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" {...props}>
      <path d="M10 12.75V3.75M6.5 7.25L10 3.75L13.5 7.25" {...stroke} strokeWidth="1.6" />
      <path
        d="M3.75 12.5V14.5C3.75 15.6 4.65 16.5 5.75 16.5H14.25C15.35 16.5 16.25 15.6 16.25 14.5V12.5"
        {...stroke}
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function CheckIcon({ size = 12, ...props }: IconProps & { size?: 12 | 14 }) {
  return size === 14 ? (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" {...props}>
      <path d="M3 7.25L5.75 10L11 4.5" {...stroke} strokeWidth="1.8" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" {...props}>
      <path d="M2.5 6.25L4.9 8.5L9.5 3.75" {...stroke} strokeWidth="1.7" />
    </svg>
  );
}

/** Small alert shown next to field errors. */
export function ErrorIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75V8.5" {...stroke} strokeWidth="1.6" />
      <circle cx="8" cy="11" r="0.95" fill="currentColor" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path
        d="M7 2.25L8.15 5.6C8.35 6.15 8.7 6.5 9.25 6.7L12.6 7.85L9.25 9C8.7 9.2 8.35 9.55 8.15 10.1L7 13.45L5.85 10.1C5.65 9.55 5.3 9.2 4.75 9L1.4 7.85L4.75 6.7C5.3 6.5 5.65 6.15 5.85 5.6L7 2.25Z"
        fill="currentColor"
      />
      <path
        d="M12.75 1.25L13.25 2.75L14.75 3.25L13.25 3.75L12.75 5.25L12.25 3.75L10.75 3.25L12.25 2.75L12.75 1.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" {...props}>
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 4.2V7L8.9 8.3" {...stroke} strokeWidth="1.3" />
    </svg>
  );
}

export function SmallPlusIcon(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" {...props}>
      <path d="M6 2.5V9.5M2.5 6H9.5" {...stroke} strokeWidth="1.6" />
    </svg>
  );
}

/** The red "PDF" document used on the uploaded-file card. */
export function PdfFileIcon(props: IconProps) {
  return (
    <svg width="34" height="42" viewBox="0 0 34 42" aria-hidden="true" {...props}>
      <path
        d="M6 1H22.5L33 11.5V37C33 39.2 31.2 41 29 41H6C3.8 41 2 39.2 2 37V5C2 2.8 3.8 1 6 1Z"
        fill="#FFFFFF"
        stroke="#DCDCE3"
        strokeWidth="1.5"
      />
      <path
        d="M22.5 1V8.5C22.5 10.2 23.8 11.5 25.5 11.5H33"
        fill="none"
        stroke="#DCDCE3"
        strokeWidth="1.5"
      />
      <path
        d="M8 28.5H26M8 32.5H20"
        fill="none"
        stroke="#E4E4EA"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect x="0" y="14" width="24" height="11" rx="3" fill="#D92D20" />
      <text
        x="12"
        y="22.2"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="7.2"
        fontWeight="700"
        fontFamily="Geist, sans-serif"
        letterSpacing="0.3"
      >
        PDF
      </text>
    </svg>
  );
}

/** A tiny CV page, in the accent colour. */
export function CvThumbIcon(props: IconProps) {
  return (
    <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true" {...props}>
      <rect x="0.5" y="0.5" width="29" height="39" rx="3.5" fill="#FFFFFF" stroke="#E2E2E7" />
      <rect x="5" y="6" width="14" height="2.5" rx="1.25" fill="#2B2B33" />
      <rect x="5" y="10.5" width="9" height="1.8" rx="0.9" fill="currentColor" />
      <rect x="5" y="16" width="20" height="1.4" rx="0.7" fill="#E3E3E7" />
      <rect x="5" y="19" width="17" height="1.4" rx="0.7" fill="#E3E3E7" />
      <rect x="5" y="22" width="19" height="1.4" rx="0.7" fill="#E3E3E7" />
      <rect x="5" y="27" width="12" height="1.4" rx="0.7" fill="#E3E3E7" />
      <rect x="5" y="30" width="16" height="1.4" rx="0.7" fill="#E3E3E7" />
    </svg>
  );
}

/** The account button's chevron; it turns over while the menu is open. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" {...props}>
      <path d="M4 5.5L7 8.5L10 5.5" {...stroke} strokeWidth="1.5" />
    </svg>
  );
}

/** "Show password". */
export function EyeIcon(props: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path
        d="M1.75 8C3.2 5.1 5.4 3.6 8 3.6S12.8 5.1 14.25 8C12.8 10.9 10.6 12.4 8 12.4S3.2 10.9 1.75 8Z"
        {...stroke}
        strokeWidth="1.4"
      />
      <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** "Hide password": the eye, struck through. */
export function EyeOffIcon(props: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path
        d="M1.75 8C3.2 5.1 5.4 3.6 8 3.6S12.8 5.1 14.25 8C12.8 10.9 10.6 12.4 8 12.4S3.2 10.9 1.75 8Z"
        {...stroke}
        strokeWidth="1.4"
      />
      <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.75 2.75L13.25 13.25" {...stroke} strokeWidth="1.4" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path
        d="M6.5 2.75H4.25C3.56 2.75 3 3.31 3 4V12C3 12.69 3.56 13.25 4.25 13.25H6.5M10.25 5.25L13 8L10.25 10.75M13 8H6.75"
        {...stroke}
        strokeWidth="1.4"
      />
    </svg>
  );
}
