# Security policy

This repository builds the static site artifact served at
<https://greatfallstoolbus.org>. It has no application server, user accounts,
or analytics. The browser may submit the public contact form to the separately
operated `forms.latoolb.us` API; this repository owns neither that service nor
its submitted data.

## Reporting a vulnerability

Report security issues privately to
[keyholders@latoolb.us](mailto:keyholders@latoolb.us) with a clear subject such
as `Security report: greatfallstoolbus.org`. Do not use the public discussion
list for unpatched vulnerabilities.

## Scope

In scope for this repository:

- Build / CI supply-chain issues
- Static site content that misrepresents this brand or the Tinyland platform posture
- Secrets accidentally committed to history
- Third-party dep vulnerabilities affecting the build pipeline

Out of scope:

- Cosmetic / SEO / accessibility issues — please open a normal issue
- DDoS / availability of the separately operated Cloudflare, tunnel, and
  on-cluster serving plane

## What we won't do

- Bug bounties (no programme yet)
- Public discussion of unfixed issues until a coordinated disclosure
  date is agreed
