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
      <h2 id="contact-heading" className="text-h2 font-bold text-slate-900 dark:text-stone-100">
        Talk to us
      </h2>
      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-card dark:border-stone-800 dark:bg-stone-900 dark:shadow-none">
        <p className="text-body leading-relaxed text-slate-600 dark:text-stone-400">
          Something wrong with an opening? Use the Report button on its page — it reaches our team
          with the full context attached.
        </p>
        <p className="mt-2 text-body leading-relaxed text-slate-600 dark:text-stone-400">
          For anything else — payments, holds, account questions — write to{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-slate-900 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:text-stone-100 dark:focus-visible:ring-stone-200"
          >
            {SUPPORT_EMAIL}
          </a>{' '}
          and include your wallet address (the NQ… one) so we can find you.
        </p>
      </div>
    </section>
  );
}
