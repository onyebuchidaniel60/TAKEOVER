// Contact — how to reach TAKEOVER. Email link plus a
// pointer at the existing in-app report flow. No contact form: there is
// no backend endpoint for one, and the report flow already carries full
// slot/claim context to the team.
//
// NOTE (owner): hello@takeover.app is a placeholder — point it at the
// real support inbox before the competition demo.
export const SUPPORT_EMAIL = 'hello@takeover.app';

export default function Contact() {
  return (
    <section aria-labelledby="contact-heading" id="contact" className="scroll-mt-20">
      <h2 id="contact-heading" className="text-h2 font-bold text-text">
        Talk to us
      </h2>
      <div className="mt-4 rounded-card border border-border bg-surface p-5">
        <p className="text-body leading-relaxed text-muted">
          Something wrong with an opening? Use the Report button on its page — it reaches our team
          with the full context attached.
        </p>
        <p className="mt-2 text-body leading-relaxed text-muted">
          For anything else — payments, holds, account questions — write to{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-flex min-h-touch items-center font-medium text-text underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {SUPPORT_EMAIL}
          </a>{' '}
          and include your wallet address (the NQ… one) so we can find you.
        </p>
      </div>
    </section>
  );
}
