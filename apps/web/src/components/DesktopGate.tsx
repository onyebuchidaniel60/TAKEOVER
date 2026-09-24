// Desktop gate (Phase 4b correction 7): TAKEOVER runs inside Nimiq
// Pay (mobile-only), so a desktop browser without the Mini App
// provider gets this explainer instead of a broken app. Centered
// column, plain consumer language (design.md §5), no jargon.
//
// QR target: `nimiqpay://miniapp?url=<host>` — the deeplink format in
// docs/deployment/manual-test.md. The manual fallback carries the
// plain https URL for cameras that ignore custom schemes. Menu path
// ("Mini Apps → Custom URL") and download host (nimpay.app) are both
// confirmed in-repo / on the official site — never invented.
import { QRCodeSVG } from 'qrcode.react';
import BrandMark from './BrandMark';

function currentOriginAndPath(): { httpsUrl: string; host: string } {
  if (typeof window === 'undefined') return { httpsUrl: '', host: '' };
  return {
    httpsUrl: `${window.location.origin}${window.location.pathname}`,
    host: window.location.host,
  };
}

export default function DesktopGate() {
  const { httpsUrl, host } = currentOriginAndPath();
  const qrValue = `nimiqpay://miniapp?url=${host}`;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col items-center justify-center px-4 py-12 text-center sm:px-6">
      <BrandMark height={32} />
      <p className="mt-8 text-small font-medium uppercase tracking-wide text-muted">Mobile only</p>
      <h1 className="mt-2 text-display font-bold text-text">TAKEOVER runs inside Nimiq Pay.</h1>
      <p className="mt-3 text-body leading-relaxed text-muted">
        Nimiq Pay is a mobile wallet for Nimiq and other chains. It is where you sign in,
        claim openings, and pay — all in one app.
      </p>
      <div className="mt-6 rounded-card bg-text p-4">
        {httpsUrl ? (
          <QRCodeSVG
            value={qrValue}
            size={192}
            bgColor="#FAFAFA"
            fgColor="#0A0A0A"
            level="M"
            title="QR code to open TAKEOVER in Nimiq Pay"
          />
        ) : null}
      </div>
      <p className="mt-3 text-body text-muted">Scan with your phone camera to open TAKEOVER.</p>
      <p className="mt-6 text-body text-muted">Or open this URL inside Nimiq Pay:</p>
      <p className="mt-1 w-full break-all rounded-control bg-surface-2 px-3 py-2 font-mono text-small text-text">
        {httpsUrl}
      </p>
      <p className="mt-2 text-small text-muted">Nimiq Pay → Mini Apps → Custom URL.</p>
      <p className="mt-6 text-body text-muted">
        Don&apos;t have Nimiq Pay yet?{' '}
        <a
          href="https://nimpay.app/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-touch items-center font-medium text-text underline"
        >
          Get Nimiq Pay
        </a>
      </p>
      <p className="mt-8 text-small text-faint">TAKEOVER · Built for Nimiq Pay · MIT licensed.</p>
    </main>
  );
}
