# Launch checklist — v1.0.0

Everything a machine could do to make this repository launch-ready has been done and verified
(see `.planning/phases/07-launch-readiness/07-12-SUMMARY.md` for the full evidence trail: eight
quality gates, DESIGN-SYSTEM §9, and the 23/23 requirement close-out). Everything below is a
step only a human — specifically, the repo owner with GitHub admin rights — can do. Work through
it in order.

## Before you tag

1. Confirm Phase 7 is merged to `master` (check `git log --oneline -1 origin/master`).
2. Re-run the full local gate suite one more time on a clean checkout:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```
3. Read `README.md` as a stranger would — does the hero animation play, do the badges render,
   would you star this, is every claim one you'd defend in a comment thread?
4. Confirm the demo credentials referenced in the README (`.env.example`'s `DEMO_ADMIN_EMAIL` /
   `DEMO_ADMIN_PASSWORD`) are the same ones the README documents — they must match exactly, since
   `DEMO_MODE` is explicitly never meant for an internet-facing instance.
5. Resolve the placeholder maintainer/security contact address. Two files currently carry the
   same clearly-marked placeholder — replace both, keeping them identical:
   - `CODE_OF_CONDUCT.md` (enforcement contact, marked `<!-- maintainer: set before launch -->`)
   - `.github/SECURITY.md` (vulnerability disclosure email, same marker)

## Repository settings

All of these are one-time, in the repo's GitHub Settings — a workflow file cannot do any of them.

1. **Make the repository public** (Settings → General → Danger Zone → Change visibility), if it
   is not already.
2. **Set the About description** (top-right "About" gear on the repo homepage) — one sentence
   matching the README pitch, e.g. *"Open-source, AI-native, self-hostable helpdesk — bring your
   own LLM, your tickets stay on your server."*
3. **Set topics** (same About panel): `helpdesk`, `customer-support`, `open-source`,
   `self-hosted`, `ai`, `llm`, `rag`, `nextjs`, `typescript`, `postgresql`, `pgvector`, `ollama`,
   `zendesk-alternative`.
4. **Upload a social preview image** (Settings → General → Social preview) — reuse a screenshot
   from `docs/assets/` (`inbox.png` or `insights.png` both read well at social-card size).
5. **Enable Discussions** (Settings → General → Features → Discussions). The issue template's
   `config.yml` already links to Discussions for questions — leaving this off produces a dead
   link on every "open an issue" flow.
6. **Settings → Pages → Source = GitHub Actions.** Required — without this, `.github/
   workflows/docs.yml` deploys the docs site to nowhere. After the first deploy, confirm
   `https://afrizzal.github.io/aida` renders **with working CSS**: an unstyled/plain-HTML page
   means the Pages URL and `base: '/aida'` in `website/astro.config.mjs` disagree.
7. **Enable private vulnerability reporting** (Settings → Code security and analysis → Private
   vulnerability reporting → Enable). This is the mechanism `.github/SECURITY.md`'s "Report a
   vulnerability" link depends on.

## Tag and release

Run from a clean `master` checkout:

```bash
git checkout master && git pull
git tag -a v1.0.0 -m "AIDA v1.0.0 — open-source, AI-native, self-hostable helpdesk"
git push origin v1.0.0
gh release create v1.0.0 --title "AIDA v1.0.0" --notes-file CHANGELOG.md --verify-tag
```

The release body will be exactly `CHANGELOG.md`'s v1.0.0 section. Before publishing, edit the
draft in the GitHub UI to lead with the hero animation (`docs/assets/aida-demo.gif`) and the
quick-start snippet from the README — release-notes readers on GitHub see the body before they
ever click through to the README.

## After the release

1. Verify the CI badge is green on the now-public README (`https://github.com/afrizzal/aida/
   actions/workflows/ci.yml`).
2. Verify `https://afrizzal.github.io/aida` renders with working styling (repeat of the Pages
   check above, now that a real tagged release exists).
3. Run the quick start on a clean machine or VM, following only what the README says — if you
   get stuck, that's a defect in the README, not in you.
4. Add the release badge to the README — `07-10` left an HTML comment marking exactly where
   (`<!-- release badge: add once v1.0.0 is tagged (Plan 07-12) -->`, currently just above the
   badge row). Replace the comment with a shields.io release badge pointing at the new tag.

## Outreach (your call, not automated)

This section is explicitly the maintainer's judgment call — timing, tone, and venue are yours to
decide, and none of it is automated by this checklist. Candidate venues, no prescribed order or
schedule:

- Hacker News (Show HN)
- r/selfhosted, r/opensource
- Relevant Discord/Slack communities for self-hosters and support-tooling builders
- Your own network / LinkedIn / X

**One hard rule, regardless of venue:** every post repeats the README's honest claims and never
invents a metric, a benchmark, or a competitor comparison the README doesn't already make. If a
claim isn't defensible in a comment thread, it doesn't go in the post.
