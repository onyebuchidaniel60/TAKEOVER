// Shared onboarding layout (Phase 5j). Focused narrow column outside the
// app chrome (no TopBar, no pill nav — see App.tsx): brand mark, optional
// step marker, eyebrow, display headline, supporting line, then the
// screen's content. One screen, max three text sizes.
import BrandMark from '../BrandMark';

export const ONBOARDING_INPUT_CLASS =
  'min-h-touch w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-body text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export const ONBOARDING_LABEL_CLASS = 'mb-1 block text-small font-medium text-muted';

export function OnboardingFieldError({ message, id }: { message: string; id?: string }) {
  return (
    <p id={id} className="mt-1 text-body font-medium text-danger" role="alert">
      {message}
    </p>
  );
}

export const ONBOARDING_PRIMARY_CTA_CLASS =
  'inline-flex min-h-touch w-full items-center justify-center rounded-pill bg-accent px-5 py-2 text-body font-semibold text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none disabled:opacity-50';

export const ONBOARDING_SECONDARY_CTA_CLASS =
  'inline-flex min-h-touch w-full items-center justify-center rounded-pill border border-border-strong bg-transparent px-5 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none disabled:opacity-50';

interface OnboardingShellProps {
  /** "Step 1 of 3" marker. Omitted on welcome/login (outside the steps). */
  step?: string;
  eyebrow: string;
  title: string;
  supporting?: string;
  children: React.ReactNode;
}

export default function OnboardingShell({ step, eyebrow, title, supporting, children }: OnboardingShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-8">
      <div aria-hidden="true">
        <BrandMark height={24} />
      </div>
      {step ? (
        <p className="mt-6 text-small font-medium text-faint">{step}</p>
      ) : (
        <div aria-hidden="true" className="mt-6" />
      )}
      <p className="mt-1 text-small font-medium uppercase tracking-wide text-muted">{eyebrow}</p>
      <h1 className="mt-2 text-display font-bold text-text">{title}</h1>
      {supporting ? (
        <p className="mt-2 max-w-md text-body leading-relaxed text-muted">{supporting}</p>
      ) : null}
      <div className="mt-6 flex flex-col gap-4">{children}</div>
    </main>
  );
}
