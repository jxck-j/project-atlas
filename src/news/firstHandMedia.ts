/**
 * Whether a first-hand post's photo/video thumbnail may leave the archive: into a published Event's dossier (`mediaUrl`), and from
 * there onto a card as the picture for an Event no outlet supplied one for (`eventPresentation.ts`).
 *
 * OFF, and it should stay off until the hard NSFW/graphic-content filter exists (design §15c: "HARD, NON-NEGOTIABLE, NO OVERRIDE";
 * §15f: its false-negative rate needs "a real, tested answer"). J asked for the fallback on 2026-09-24 — a first-hand picture
 * satisfying an Event's thumbnail when it has none — and the plumbing is built and tested, but the switch is here because:
 *
 *  - these channels mostly post raw footage (ClashReport: 47 of 59 posts in one live fetch had video), so the picture an Event
 *    would borrow is very often a frame of combat, and nothing yet checks it;
 *  - `public/data/news-events.json` is SERVED. A URL in it is published whatever the client chooses to render — the same reason the
 *    head-of-state-death queue lives in debug/, not public/ — so this cannot be a UI-only gate. The build omits the field entirely
 *    while this is false.
 *
 * To turn it on, build the filter first, then flip this in the same change. Turning it on before then is a decision to accept that
 * exposure, and should be made explicitly, not by editing a constant.
 */
export const FIRST_HAND_MEDIA_ENABLED = false
