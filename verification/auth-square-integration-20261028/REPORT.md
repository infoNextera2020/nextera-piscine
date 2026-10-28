# Shared auth square artwork integration — 28 October 2026

The supplied Blender square render is wired into both login and invitation signup through the existing shared component. The source render and supplied upper-ratio crop were inspected locally. Archive Library identity, all image hashes, PNG dimensions and preservation of every previous artwork file were verified.

Square WebP widths 600/900/1280 are 14,620 / 34,206 / 94,624 bytes. PNG fallback is 1,964,752 bytes and retains the same square composition. These are measured file sizes, not browser request counts or performance scores. The existing portrait is retained outside the conservative square media range.

The measured user panel (639×631) is covered by square art. Centered cover also requires the actual panel size-container ratio to remain within the supplied 0.80–1.3296875 bounds; visual-viewport changes outside them fall back to contain. Original portrait cover remains limited to its inspected range. Unsupported container queries retain complete canvases. Mobile art stays hidden; existing viewport/form handling and account behavior were not changed. The change does not promise full bleed at every extreme aspect ratio.

Passed: **1,075 source tests**, **10 focused invitation/auth presentation tests**, typecheck, lint, formatting and production build. Four supplied crop transforms and twelve static viewport/keyboard-height cases passed. Static crop math and server-rendered markup do not establish browser layout, accessibility or no-scroll behavior.

Browser `net::ERR_NETWORK_ACCESS_DENIED` remains unresolved; no browser retry, alternate route, screenshot capture, new listener or security change occurred. There are no new application screenshot Library IDs. The Windows Library helper could not persist xattrs; the same current official helper subsequently completed materialization on the same laptop's Ubuntu filesystem with verified Library metadata. No untracked bytes or substitute artwork were used.

The Checkpoint HTTP milestone remains committed separately in `a2180be`. No new Auth/DB/Runner setup or curriculum change occurred. The revised Quest 2 direction is accepted but its exact module artifact is still awaited. All four unrelated dirty-file hashes remain unchanged and excluded from staging. Original artwork remains untouched.
