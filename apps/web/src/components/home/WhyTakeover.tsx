// Why TAKEOVER: problem → solution in one section. Two short
// paragraphs, stacked on mobile, two columns on tablet+. The visual is
// pure CSS (stacked mini-cards) — no icon budget spent, no photography.
export default function WhyTakeover() {
  return (
    <section aria-labelledby="why-heading">
      <h2 id="why-heading" className="text-h2 font-bold text-text">
        Why TAKEOVER
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-h3 font-semibold text-text">The problem</p>
          <p className="mt-1 text-body leading-relaxed text-muted">
            Evenings sell out while good tables sit empty. Cancellations happen every day, but
            there is no fast way to pass them on — so providers eat the loss and buyers never
            hear about the opening.
          </p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-h3 font-semibold text-text">The solution</p>
          <p className="mt-1 text-body leading-relaxed text-muted">
            TAKEOVER is the shared board for released capacity. Providers post an opening in
            under a minute; buyers claim it on the spot. Payment is held safely until delivery
            is confirmed.
          </p>
          <div aria-hidden="true" className="mt-3 flex items-center gap-2">
            <span className="h-8 w-14 rounded-chip bg-surface-2" />
            <span className="h-8 w-14 rounded-chip bg-accent" />
            <span className="h-8 w-14 rounded-chip bg-surface-2" />
          </div>
        </div>
      </div>
    </section>
  );
}
