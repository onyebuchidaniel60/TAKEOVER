// Phase 14k-1: FAQ — six questions in consumer language, native
// <details> disclosures. Deliberately unanimated: occasional frequency
// does not justify custom motion, native disclosure is keyboard-free and
// reduced-motion-safe by construction, and it matches the ClaimsPage
// bucket pattern buyers already know.
const ITEMS = [
  {
    question: 'What is TAKEOVER?',
    answer:
      'TAKEOVER is a last-minute marketplace for released capacity. Providers list tables, seats, and appointments that just opened up — you claim one in a couple of taps instead of calling around.',
  },
  {
    question: 'How does payment work?',
    answer:
      'You pay in the app when you claim. Your payment is held safely and only released to the provider after delivery — when you confirm, or when the review window passes without a dispute. The provider never sees your payment details.',
  },
  {
    question: 'What if the provider doesn’t deliver?',
    answer:
      'If the provider never marks your slot delivered by the deadline, your payment comes back to you automatically. If you showed up and something was wrong, open a dispute from your claim and our team reviews it.',
  },
  {
    question: 'What is NIM used for?',
    answer:
      'NIM is the Nimiq currency providers use to publish a listing — a small listing fee keeps the marketplace free of spam. As a buyer you only ever pay the slot price.',
  },
  {
    question: 'What does it cost to list a slot?',
    answer:
      'Publishing a slot costs a small fixed fee of 400 NIM, paid once per listing from the provider’s Nimiq wallet. Buyers pay nothing extra beyond the slot price.',
  },
  {
    question: 'How do I contact support?',
    answer:
      'Write to hello@takeover.app and include your claim or slot details. If something is wrong with a specific opening, use the Report button on its page so our team sees the full context.',
  },
];

export default function Faq() {
  return (
    <section aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-h2 font-bold text-bark dark:text-parchment">
        Questions, answered
      </h2>
      <div className="mt-4 flex flex-col gap-2">
        {ITEMS.map((item) => (
          <details
            key={item.question}
            className="rounded-xl border border-hairline bg-cream px-4 py-3 shadow-card dark:border-rootline dark:bg-cocoa dark:shadow-none"
          >
            <summary className="min-h-touch cursor-pointer list-none text-body font-semibold text-bark dark:text-parchment [&::-webkit-details-marker]:hidden">
              {item.question}
            </summary>
            <p className="mt-2 border-t border-hairline pt-2 text-body leading-relaxed text-taupe dark:border-rootline dark:text-drift">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
