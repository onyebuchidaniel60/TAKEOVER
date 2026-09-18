# REFERENCE-ANALYSIS — nimiq-pay-reference-video.mp4

Stylistic reference for the TAKEOVER demo video (Phase 15a). Studied via
frame extraction (97 frames @ fps=2), scene-cut detection, ffprobe metadata,
and signal-level audio probes (volumedetect / silencedetect / ebur128).
I cannot listen to audio, so §4's music/SFX claims are signal measurements
plus caption evidence — marked where inferred.

Source facts: 48.55s, 1662×1080, ~30fps, H.264 + AAC stereo 44.1kHz, 7.3MB.
Letterboxed (black bars top/bottom; content ~16:9). Length is inside the
normal band (not <30s, not >3min) — pacing guidance applies unadjusted.

## 1. Overall feel

First 5s land **news, not branding**: a giant serif headline states what
changed ("Binance now lets you trade stocks on Binance") over a huge product
word ("bStocks"). Emotion is confident-insider — "here's what just opened
up, and I built the thing that exploits it." Energy stays high and even:
no quiet stretch, no slow build, no breather. It feels like a founder
talking fast over screen shares, not a brand film.

## 2. Pacing

Only 3 hard scene cuts in 48.5s (detected at 9.43s, 13.18s, 17.68s) — 4 shots:

- 0.0–9.4s (~9.4s): title hook card, held long enough to read twice.
- 9.4–13.2s (~3.7s): problem/chaos collage — shortest shot, a punch.
- 13.2–17.7s (~4.5s): numbered 5-step "how it works" strip.
- 17.7–48.4s (~30.7s): ONE uncut screen-recorded demo (dark terminal,
  visible cursor, real typos left in). No end card in sampled frames —
  the demo runs to the end.

It breathes by holding shots, not by slowing down: long takes + fast VO.
Cut rhythm follows idea changes, never a beat grid. The 30s single take is
the thesis — proof beats polish.

## 3. Visual language

- **Color grading:** flat bright white background, near-black text, exactly
  one brand accent (Binance yellow) plus red/green data semantics. No
  gradients, no vignette, no film look. High-key, high-contrast, vector-clean.
- **Typography:** two-voice system. Display: big italic serif (headline +
  giant product word, tight tracking). Everything else: plain sans —
  small-caps kickers ("AI × TRADING × PROTECTION"), card labels, bold
  uppercase karaoke captions. Serif = the news; sans = the evidence.
- **Shot composition:** title is centered with generous negative space and
  faint decor at the edges (candlestick charts, dotted world map, floor
  reflection under the giant word). Problem shot fills the frame edge to
  edge (density = overwhelm). Steps shot is a 5-column strip, lots of air.
  Demo is full-bleed screen recording, uncropped.
- **Transitions:** hard cuts only. Zero dissolves, wipes, or morphs detected.
  Within-shot motion is content motion (cursor, typing), not camera motion.

## 4. Sound design

- **Music:** a continuous bed under the whole piece (inferred: zero gaps
  ≥0.5s below −30dB across 48.5s — sound runs wall-to-wall). Master is hot
  and tight: integrated −15.3 LUFS, LRA 3.4 LU, peaks at 0 dBFS — a loud,
  heavily consistent social-video master, not a dynamic film mix.
- **VO:** present throughout (karaoke captions in every sampled frame).
  Caption text shows conversational first-person builder language
  ("DIRECTLY SO I BUILT", "SO INSTEAD OF JUST", "HERE'S HOW IT WORKS") —
  scripted but spoken plainly, fast, no announcer polish. Accent/delivery
  beyond that is not measurable from frames; assumed neutral-conversational.
- **SFX:** none detectable as distinct events from signal stats (no
  transient spikes separable from the hot master; LRA 3.4 LU leaves little
  room for spot effects). If SFX exist they are buried — the mix is
  VO + bed only, as far as measurement can tell.

## 5. What makes it good

1. The hook is a sentence, not a logo — you know the news by second 3.
2. The chaos collage makes the problem *felt* (density, red down-charts,
   a stressed stick figure) instead of stated.
3. The 5-step strip answers "how it works" in one glanceable image.
4. The 30s uncut demo with typos and cursor is more persuasive than any
   animation: it proves the thing runs.
5. Karaoke captions (white bold + purple active-word box, bottom-center)
   make it watchable muted and pace the eye to the VO.
6. One accent color + two type voices = a complete brand system from
  almost nothing.

## 6. What would NOT translate to TAKEOVER

- **Doodle/stick-figure art.** We have a real, warm, finished app UI —
  hand-drawn figures would cheapen it. Our "characters" are real listings.
- **Terminal/screen-recording as the proof tail.** Ours is a consumer
  mobile-web marketplace; the proof is the feed + escrow panel + the
  owner-supplied phone recording, presented as designed frames, not raw
  capture. A 30s raw take of a checkout flow would read as a bug report.
- **Binance yellow-on-black + purple karaoke boxes.** Our accents are
  terracotta (#9D5A30) on ivory; caption highlight must be terracotta.
- **No end card.** We are a competition submission — we need the live URL
  + MIT note on screen at the end. The reference can end on demo; we can't.
- **Fabricated-looking floating UI cards.** The reference's collage cards
  are illustrative. Every TAKEOVER UI pixel must be a real screenshot —
  submission integrity (per phase brief: never invent a transaction).

## 7. Principles we WILL adopt

1. **Land the news in the first 5 seconds** — product name + one-line
   payoff on screen immediately; no logo animation, no cold open.
2. **One idea per shot; cut only when the idea changes** — hold 4–9s+ per
   beat, hard cuts throughout, no dissolves or decorative transitions.
3. **Karaoke captions carry the VO** — bold bottom-center captions with
   the active phrase highlighted in terracotta; the video must work muted.
4. **Real product pixels for proof** — feed, slot, escrow panel, and the
   owner phone recording are presented as-shot; nothing restaged, nothing
   invented.
5. **Chaos-then-order arc** — problem as one dense typographic beat (≤5s),
   then the app as the calm ordered answer; trust beat as the calmest shot.
6. **Hot continuous mix, VO first** — VO up front and intelligible, music
   bed felt-not-heard wall-to-wall, no dead air between beats.
7. **Two type voices + one accent do the branding** — display serif-style
   presence for the giant TAKEOVER word vs plain system sans for UI truth;
   terracotta is the only loud color on ivory.
8. **End on the name + where to get it** — end card with brand mark, live
   URL, MIT note; the VO's last word lands with the last image.
