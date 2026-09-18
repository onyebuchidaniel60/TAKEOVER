---
format: 1920x1080
duration: 89s
message: "Last-minute availability, claimed."
arc: Hook â†’ Problem â†’ Demo (buyer loop) â†’ Proof (wallet + provider) â†’ Trust â†’ CTA
audience: competition judges and first-time buyers/providers
mode: autonomous
music: warm calm minimal underscore
---

## Video direction

One film, one grammar â€” every frame inherits this; per-frame entries carry only the delta.

- **Palette (frame.md roles, TAKEOVER hex):** ground ivory `#FAF6EC`; cards
  cream `#F4EDDD`; inset sand `#E8DCC3`; ink bark `#453727`; secondary taupe
  `#5F4F3B`; accent terracotta `#9D5A30` (scarce voltage only â€”
  active caption phrase, one keyword per frame max, CTA). Dark beats: ground
  coal `#1D130C`, cards cocoa `#2B1E12`, text parchment `#F1E7D2`. Never pure
  black/white, never cool gray, never gradients/particles/glow-as-decoration.
- **Type (system stacks â€” the app ships no webfonts):** display Georgia,
  'Times New Roman', serif, tight negative tracking for the giant TAKEOVER
  word and headlines; body system-ui for UI truth and captions; figures
  (prices, counts) ui-monospace + tabular-nums. Tracking size-specific
  (tight display, neutral body).
- **Motion grammar:** long-tail smooth settles (`power3`, never bounce);
  entrances ease-out â‰¤300ms, transform + opacity only; reveals paced to the
  VO with development in the back ~50% â€” nothing appears before the voice
  names it. Holds keep at most a low-amplitude finite jitter; no breathing,
  no back-half pans (F3's scroll travel is the one motivated exception â€”
  the camera reads the feed top to bottom as the VO tours it). Internal
  seams are velocity-matched cuts.
- **Rhythm:** reveal-hold alternation â€” F1 hold, F2 punch, F3â€“F7 demo run,
  F8 full hold (calmest), F9 flip, F10 earned hold. Money moment (F5) gets
  the longest hold and the riser; trust (F8) gets stillness + no SFX.
- **Negative list:** no fade-to-black between beats (hard cuts per
  `transition_in`); no slow zoom on static screenshots (F3 travels, never
  zooms); no marketing-copy voice ("revolutionizing" banned â€” product's own
  plain words only); no particles/glow/bokeh/AI gradients; no kinetic type
  that spins or bounces; no shot that only fills time.
- **Caption band:** bottom ~17% reserved for the karaoke caption pill;
  frame content lives in the top ~83%.

## Frame 1 â€” Title

- scene: Giant TAKEOVER word over the one-line pitch on ivory
- voiceover: "Every night, tables, seats, and courts open up at the last minute. Most of them go to waste."
- duration: 8.5s
- transition_in: cut
- status: animated
- src: compositions/frames/01-title.html
- type: hook
- persuasion: Pain validation
- beat: curiosity
- blueprint: titlecard-reveal (Reproduce) â€” calm single-card landing, one restrained entrance, then hold
- asset_candidates: assets/svgs/logo-23d356d0.svg â€” brand mark from capture; assets/icon-512.png â€” app icon for end card use
- focal: the giant TAKEOVER word (typeset, not an image)
- roles: wordmark = cutout Â· pitch line = supporting Â· ivory ground = background
- sfx: chime â€” warm arrival under the wordmark (principle 1: land, don't animate)

narrativeRole: Land the news in the first 5 seconds â€” name + payoff, no logo animation (principle 1).
keyMessage: Takeover claims last-minute availability.

Shot: Scene 1 (0.0â€“1.2s): ivory ground; kicker "A Nimiq Pay mini app" fades up, then the giant TAKEOVER word assembles via per-word staggered reveal, terracotta period. Centered hero, ~60% of frame. Scene 2 (1.2â€“4.2s): as the VO reaches "go to waste," the pitch line "Last-minute availability, claimed." reveals under the wordmark â€” the back-half reveal, timed to the script. Scene 3 (4.2â€“6.0s): held read, still.

## Frame 2 â€” Problem

- scene: Dense typographic beat â€” cancelled plans, empty tables, missed evenings
- voiceover: "Someone cancels dinner. A court sits empty. You'd have loved it â€” you just never knew."
- duration: 9.4s
- transition_in: cut
- status: animated
- src: compositions/frames/02-problem.html
- type: pain_point
- persuasion: Pain agitation
- beat: frustration â†’ FOMO
- blueprint: kinetic-type-beats (Adapt) â€” keep the solo-landing pain statements; three lines not five, no product, density is the overwhelm (principle 5)
- asset_candidates: none â€” pure typography
- focal: the three pain lines (typeset)
- roles: pain lines = cutout Â· ivory ground = background
- sfx: whoosh â€” punctuates the hard cut in (principle 2)

narrativeRole: Make the pain felt in one dense â‰¤5s beat; the app is the calm answer (principle 5).
keyMessage: Good openings die unseen every night.

Shot: Scene 1 (0.0â€“0.4s): hard cut in â€” "Someone cancels dinner." slams via hard-cut word-swap, upper third. Scene 2 (0.4â€“2.6s): "A court sits empty." swaps in beneath it on the VO cue; then "You'd have loved it â€”" a third line. Scene 3 (2.6â€“5.0s): "you just never knew." lands largest in terracotta and holds still â€” the sting reads against the prior rhythm.

## Frame 3 â€” Marketplace feed

- scene: The live feed, populated, filters on top â€” slow vertical travel down the plate
- voiceover: "Takeover is the marketplace for released openings. Real tables, real seats, near you, right now."
- duration: 9.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/03-feed.html
- type: product_intro
- persuasion: Show-don't-tell proof
- beat: relief + curiosity
- blueprint: cursor-ui-demo (Adapt) â€” keep the cursor-led first look; the camera travels the real plate instead of chasing clicks (principle 4: real pixels, shown as-shot)
- asset_candidates: assets/feed-full.png â€” full-page capture plate (1920Ã—1962, 1x); assets/feed-top.png â€” viewport top with filters
- focal: assets/feed-full.png
- roles: plate = cutout (the traveling subject) Â· ivory ground = background Â· filter chips highlighted in place = supporting
- sfx: whoosh + click â€” travel starts, then a soft click as the Ember Room card centers

narrativeRole: First proof â€” the product is real, populated, and warm (principle 4).
keyMessage: The feed is alive with real openings.

Shot: Scene 1 (0.0â€“2.0s): viewport opens on the plate top (filters visible) via pan/focus-lock; kicker "Available now" sits in the margin. Scene 2 (2.0â€“6.0s): as the VO names "real tables, real seats," the viewport travels down the plate to the two listing cards â€” the only camera travel in the video, motivated by touring the feed. Scene 3 (6.0â€“8.0s): settle on the Ember Room card centered; a soft click; held read.

## Frame 4 â€” Slot detail

- scene: One opening â€” Ember Room dinner â€” time, USDT price, availability
- voiceover: "See one you like? Open it. The time, the price in U S D T, and how many are left â€” all there."
- duration: 10.5s
- transition_in: cut
- status: animated
- src: compositions/frames/04-slot.html
- type: feature_showcase
- persuasion: Feature-to-benefit translation
- beat: clarity
- blueprint: cursor-ui-demo (Adapt) â€” keep one workflow step in the real surface; cursor rests on the card, facts glow as named (principle 4)
- asset_candidates: assets/slot-ember.png â€” honest reframed crop of the real Ember Room feed card (crop of assets/feed-top.png region, no field invented, no detail page fabricated)
- focal: assets/slot-ember.png
- roles: card crop = cutout Â· ivory ground = background Â· fact callouts (time / 0.0035 USDT / 4 available) = supporting, revealed on cue
- sfx: click â€” soft UI confirmation as each fact is named

narrativeRole: Concretize the value â€” one real listing, every fact visible (principle 4).
keyMessage: Every opening shows time, price, and scarcity honestly.

Shot: Scene 1 (0.0â€“1.5s): card crop enters centered (~65% of frame), spring-pop entrance with smooth long-tail settle. Scene 2 (1.5â€“5.5s): as the VO names each fact â€” time, then price, then availability â€” a keyword glow lands on that row of the card in place; nothing else moves. Scene 3 (5.5â€“8.0s): full card held still for the read.

## Frame 5 â€” Claim escrow (money moment)

- scene: The escrow panel idea in the product's own words â€” "held safely until you confirm"
- voiceover: "Claim it in one tap. Your payment is held safely, and only released when the evening goes ahead."
- duration: 9.1s
- transition_in: cut
- status: animated
- src: compositions/frames/05-escrow.html
- type: feature_showcase
- persuasion: Friction reduction
- beat: confidence
- blueprint: titlecard-reveal (Adapt) â€” keep the calm two-line value title + still hold; the panel is typographic because the wallet-gated escrow screen cannot be captured headlessly â€” shown in the app's real FAQ words, never a fabricated panel (integrity note; principle 4)
- asset_candidates: none â€” typographic; copy is the captured FAQ line "Your payment is held safely until you confirm" (capture/extracted/visible-text.txt)
- focal: the held-safely lockup (typeset, real words)
- roles: lockup = cutout Â· terracotta hold bar = supporting Â· ivory ground = background
- sfx: riser â€” builds across the frame into the hold reveal; the peak beat gets the peak sound

narrativeRole: The peak â€” money held safely; cuts, audio, and SFX all build here.
keyMessage: Your money is held, not handed over.

Shot: Scene 1 (0.0â€“2.0s): "Claim it in one tap." + a single Claim button card, centered. Scene 2 (2.0â€“6.0s): as the VO says "held safely," a terracotta hold bar fills beneath and the real line "Your payment is held safely until you confirm." reveals word by word â€” the riser crests here. Scene 3 (6.0â€“9.0s): "released when the evening goes ahead" settles below; everything holds still â€” longest hold in the video.

## Frame 6 â€” Nimiq Pay wallet segment

- scene: Owner phone recording composited as a held phone â€” wallet connects, claims live in one place
- voiceover: "Connect your wallet once. Your claims live in one place, ready when you are."
- duration: 7.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-wallet.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: control
- blueprint: device-surface-showcase (Reproduce) â€” real recorded flow inside a held device; static hold, the footage moves (principle 4; blur-crossfade only because dark footage meets ivory ground)
- asset_candidates: assets/nimiq-pay-segment.mp4 â€” owner-supplied phone recording, media range ~5â€“12s (wallet connected, claims screen); never a fabricated wallet
- focal: assets/nimiq-pay-segment.mp4
- roles: phone footage = cutout (centered device, ~40% of frame) Â· ivory ground = background Â· margin label "Shot on a real phone" = supporting
- sfx: click â€” one soft confirmation as the claims screen lands

narrativeRole: Proof the wallet flow is real â€” option (a), shown as-shot, no invented transaction.
keyMessage: Real wallet, real claims, on your phone.

Shot: Scene 1 (0.0â€“1.0s): phone lands centered via spring-pop entrance, footage starts at media range in. Scene 2 (1.0â€“7.0s): footage plays (wallet connected â†’ claims); margin label reveals on the VO's "one place." Scene 3 (7.0â€“9.0s): held on the claims screen; still.

## Frame 7 â€” Provider flow

- scene: Sell â†’ publish â†’ the 400 NIM fee in the product's own FAQ words
- voiceover: "And if your own plans change? List your table in a minute. Publishing costs four hundred Nimiq, paid once."
- duration: 10.5s
- transition_in: cut
- status: animated
- src: compositions/frames/07-publish.html
- type: feature_showcase
- persuasion: Friction reduction
- beat: ease
- blueprint: cursor-ui-demo (Adapt) â€” keep the end-to-end steps onto the fee line; fee shown in captured FAQ words, never a fabricated payment sheet (integrity note)
- asset_candidates: assets/feed-top.png â€” staged feed capture for the Sell entry point; fee copy is the captured FAQ line "Publishing a slot costs a small fixed fee of 400 NIM" (capture/extracted/visible-text.txt)
- focal: the three publish steps (typeset from real product copy)
- roles: steps = cutout Â· feed capture strip = background (dim ~40%) Â· fee line = supporting, lands last in terracotta
- sfx: click â€” as the fee line locks in

narrativeRole: Mirror the buyer loop for providers â€” listing is as easy as claiming.
keyMessage: Providers publish in a minute; one small NIM fee keeps spam out.

Shot: Scene 1 (0.0â€“2.0s): three steps â€” "Describe it. Set the time. Publish." â€” assemble in a staggered cascade over the dimmed feed strip. Scene 2 (2.0â€“5.5s): as the VO names the fee, the real line "Publishing costs a small fixed fee of 400 NIM, paid once." reveals beneath with a soft click. Scene 3 (5.5â€“8.0s): held read.

## Frame 8 â€” Trust beat

- scene: Three calm lines â€” held until delivery, released on confirmation, refunded if never delivered
- voiceover: "You're covered either way. If the evening never happens, your money comes straight back."
- duration: 8.1s
- transition_in: cut
- status: animated
- src: compositions/frames/08-trust.html
- type: benefit_highlight
- persuasion: Risk reversal
- beat: trust + peace of mind
- blueprint: titlecard-reveal (Reproduce) â€” near-still cards, one restrained entrance each, then stillness; low motion is the payload (principle 5: trust is the calmest shot)
- asset_candidates: none â€” typographic, copy paraphrases the captured FAQ refund line ("your payment comes back to you automatically")
- focal: the three trust lines (typeset)
- roles: lines = cutout Â· ivory ground = background
- sfx: none â€” deliberate; the calmest shot gets bed + VO only (principle 5)

narrativeRole: Risk reversal in plain consumer words; no chain vocabulary.
keyMessage: Delivery or refund â€” no middle ground where you lose.

Shot: Scene 1 (0.0â€“2.5s): "Held until delivery." reveals via per-word staggered reveal. Scene 2 (2.5â€“4.5s): "Released when you confirm." joins it on cue. Scene 3 (4.5â€“7.0s): "Refunded if it never happens." lands in terracotta; full stillness to the end.

## Frame 9 â€” Dark mode

- scene: The warm dark theme â€” cocoa cards, parchment text â€” flip moment from the real phone footage
- voiceover: "Light or dark, it feels like home. Warm, calm, and ready when plans change."
- duration: 8.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/09-dark.html
- type: feature_showcase
- persuasion: Value stacking
- beat: belonging
- blueprint: titlecard-reveal (Adapt) â€” keep the single restrained reveal; the reveal IS the theme flip on a real dark-mode still (principle: craft beat, designed not derived)
- asset_candidates: assets/dark-feed.png â€” real dark-mode still extracted from the owner phone recording (ffmpeg frame grab, never recolored)
- focal: assets/dark-feed.png
- roles: dark still = cutout (centered phone, ~40%) Â· coal ground = background (the whole ground flips ivoryâ†’coal here)
- sfx: whoosh â€” masks the ground flip with the blur-crossfade

narrativeRole: Craft beat â€” the theme is a design system, not an inversion.
keyMessage: Dark mode is warm deep brown, designed not derived.

Shot: Scene 1 (0.0â€“1.5s): ground flips ivoryâ†’coal through the blur-crossfade; phone with the dark still settles centered. Scene 2 (1.5â€“4.0s): margin line "Warm dark. Same calm." reveals as the VO lands "feels like home." Scene 3 (4.0â€“6.0s): held read on coal.

## Frame 10 â€” End card

- scene: Brand mark, live URL, MIT license note â€” held still
- voiceover: "Takeover. Last-minute availability, claimed. Live now â€” link on screen."
- duration: 9s
- transition_in: cut
- status: animated
- src: compositions/frames/10-endcard.html
- type: cta
- persuasion: Status seeking
- beat: motivation
- blueprint: titlecard-reveal (Reproduce) â€” calm end-card stack terminating on the held URL (principle 8: end on the name + where to get it; VO's last word lands with the last image)
- asset_candidates: assets/icon-512.png â€” app icon, real repo asset
- focal: live URL line (typeset mono)
- roles: mark + name = cutout Â· URL = supporting, locks in terracotta Â· MIT note = supporting small Â· ivory ground = background
- sfx: chime â€” resolves the piece as the URL locks (principle 8: music resolved, not cut off)

narrativeRole: Earned close â€” URL + MIT note on screen for the submission.
keyMessage: Takeover is live â€” go claim something tonight.

Shot: Scene 1 (0.0â€“1.5s): mark + TAKEOVER resolve centered, one restrained entrance. Scene 2 (1.5â€“3.5s): "takeover-web-gamma.vercel.app" types on in mono with a chime as the VO says "link on screen." Scene 3 (3.5â€“6.0s): "MIT licensed. Built on Nimiq Pay." settles small beneath; held to the last frame while the music resolves.
