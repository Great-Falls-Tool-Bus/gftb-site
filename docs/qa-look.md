# qa-look (reserved name)

`qa-look` is reserved for a routable, tailnet-only environment for each pull
request, bound to its exact head and reaped after the operator's LOOK.
The retired screenshot job provided no such environment.

Operator ruling (2026-09-03, verbatim):

> the current qa-look is a completely hallucinated implementation that is NOT
> at all what qa-look means. excise that false, made up, incorrect qa-look
> phase. PullRequestEnvironment/v1 v4 is the only correct lane; a job and code
> literally called QA look should be the canonical development flow for
> LOOKing at a QA dev environment.

The browser acceptance suite runs separately through `just test-e2e`.
