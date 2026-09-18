// Phase 14k-1: Contact — how to reach TAKEOVER. Email link plus a
// pointer at the existing in-app report flow. No contact form: there is
// no backend endpoint for one, and the report flow already carries full
// slot/claim context to the team.
//
// NOTE (owner): hello@takeover.app is a placeholder — point it at the
// real support inbox before the competition demo.
export const SUPPORT_EMAIL = 'hello@takeover.app';

export default function Contact() {
  return (
    <section aria-labelledby="contact-heading">
      <h2 id="contact-heading" className="text-h2 font-bold text-bark dark:text-parchment">
        Talk to us
      </h2>
      <div className="mt-4 rounded-2xl border border-hairline bg-cream p-5 shadow-card dark:border-rootline dark:bg-cocoa dark:shadow-none">
        <p className="text-body leading-relaxed text-taupe dark:text-drift">
          Something wrong with an opening? Use the Report button on its page — it reaches our team
          with the full context attached.
        </p>
        <p className="mt-2 text-body leading-relaxed text-taupe dark:text-drift">
          For anything else — payments, holds, account questions — write to{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-bark underline focus:outline-none focus-visible:ring-2 focus-visible:ring-terra dark:text-parchment dark:focus-visible:ring-terralight"
          >
            {SUPPORT_EMAIL}
          </a>{' '}
          and include your wallet address (the NQ… one) so we can find you.
        </p>
      </div>
    </section>
  );
}
