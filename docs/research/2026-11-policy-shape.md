# Research note: the shape of the path, signal and extension policy

Written 2026-11-22 to support the decisions of the same date in
[decisions](../decisions.md). It summarises what outside practice does about
three questions, and says how far each finding transfers to this kit's setting:
a solo owner, one GitHub identity for the human and the agent, the free plan.

1. Do leading practitioners still keep a list of sensitive paths, or do they
   solve the problem structurally?
2. Which signals do they trust when a program decides to merge, and how are
   those signals kept from being forged or going stale?
3. How do mature systems let each repository add its own rules?

## How to read the claims

Every claim carries one of three marks.

- **V** (verified): a quotation that was extracted by script from the text of
  the cited page and compared with the claim. These are official
  documentation, source code or a paper's abstract, read on 2026-11-22.
- **S** (summarised): the page was read through a fetch tool that returns a
  model-written summary, so the quotation is probably faithful but was not
  checked against the page text. Re-open the page before relying on it.
- **I** (inference): the author's reasoning from documented facts.

Preprints are named as preprints. A claim is included only if it is marked.

## What was not found

No published account was found of a solo operator, with one GitHub identity,
whose unattended agent merges its own pull requests. Every large-organisation
source below separates the agent's identity from the people who approve, which
this setting cannot do. The transfer of each finding to this kit's setting is
therefore **I**, the author's inference, throughout. The nearest report found
was a single practitioner's public issue describing the same-account bypass of
a required check; it is not linked here.

## 1. Sensitive paths

**What large organisations do.**

- Universal ownership with default deny. A change must be approved by an
  owner of every directory it touches (**S**).
  Chromium: "You must get a positive review from an owner of each directory
  your change touches."
  <https://chromium.googlesource.com/chromium/src/+/main/docs/code_reviews.md>.
  GitHub's code owners file is read from the pull request's base branch
  (**S**): <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners>.
  This is a path list, but the opposite shape: it covers the whole tree and
  routes to people. It needs a second person (**I**).
- A short list appears as a backstop in front of a risk model, not as the main
  mechanism (**S**). A paper on automatic landing of low-risk changes reports
  file blocklists and scope exclusions ahead of a model, bot changes accepted
  only from onboarded sources, and a model that must classify every change
  into a safe category: <https://arxiv.org/html/2605.30208>. The same company
  earlier replaced expert-chosen path freezes by a per-change score, citing
  imprecision: "requires constant manual effort to update"
  (<https://arxiv.org/html/2410.06351v1>, **S**). The complaint is
  over-blocking, not misses (**I**).
- Agent vendors protect the agent's own control plane with built-in lists:
  hooks, editor and git configuration, package-manager configuration, agent
  settings (**S**).
  <https://code.claude.com/docs/en/permission-modes>,
  <https://learn.chatgpt.com/docs/agent-approvals-security>.
  They do not list a repository's workflow directory (**S**).
- A preprint on 26,999 agent pull requests recommends holding any pull request
  that touches CI or infrastructure directories, with a non-author sign-off
  (**S**, preprint): <https://arxiv.org/abs/2610.12849>.
- Automatic merge scoped by kind of change, not by forbidden files: a
  dependency bot merges only when a named kind of update is green (**S**):
  <https://docs.renovatebot.com/key-concepts/automerge/> ("By default,
  Renovate will not automerge until it sees passing status checks / check runs
  for the branch."). The category allowlist of the first paper above is the
  same shape.
- Agent-first accounts (OpenAI, Stripe, Spotify) describe no path list. One
  states that minimal blocking gates "would be irresponsible in a low-throughput
  environment" and that corrections are cheap when throughput is high (**S**):
  <https://openai.com/index/harness-engineering/>. Absence from a blog post is
  weak evidence of absence in practice (**I**).

**Structural alternatives that do not transfer, and why.**

- A distinct agent identity with enforced limits. GitHub's cloud agent "only
  has the ability to push to a single branch", "cannot mark its pull requests
  as "Ready for review" and cannot approve or merge a pull request", and the
  user who asked for a pull request is prevented from approving it (**V**):
  <https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations>.
  This needs a second identity and a second approver (**I**).
- A restricted execution context for bot pull requests (**S**): dependency-bot
  runs "receive a read-only `GITHUB_TOKEN` and do not have access to any
  secrets that are normally available"
  (<https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions>).
  It works because the bot is a distinct actor (**I**).
- Environments with required reviewers. On the free plan environments can be
  configured only for public repositories: "Users with GitHub Free plans can
  only configure environments for public repositories." (**V**)
  <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>.
  A deploy-branch restriction on an environment is the part that needs no
  second approver (**I**).
- Branch protection and rulesets. The restrictions "don't apply to people with
  admin permissions to the repository" by default (**V**):
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>.
  An administrator can edit rulesets, so with one admin identity they are a
  guardrail (**I**).
- The vendor's cloud proxy keeps tokens outside the sandbox and scopes API
  access to attached repositories, but "doesn't limit which branches a push can
  update" (**S**): <https://code.claude.com/docs/en/cloud-environments>.

**Why a hold at merge time cannot protect against pre-merge execution (V).**
For a same-repository `pull_request` run, the workflow that runs is the one in
the pull request's merge commit, and a workflow file may grant itself
`checks: write` or other permissions:

- "Last merge commit on the GITHUB_REF branch" is the `GITHUB_SHA` for
  `pull_request`, while `pull_request_target` "runs in the context of the
  default branch of the base repository, rather than in the context of the
  merge commit": <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>.
- "You can use permissions either as a top-level key, to apply to all jobs in
  the workflow, or within specific jobs." and "checks: write permits an action
  to create a check run." <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>.

GitHub's secrets documentation says "With the exception of `GITHUB_TOKEN`,
secrets are not passed to the runner when a workflow is triggered from a
forked repository" (**S**):
<https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions>.
That a same-repository `pull_request` run does receive the repository's
secrets follows from the fork exception; it has not been tested (**I**).

**Conclusion (I).** Practice keeps a small list defined by what a file can do
(change the agent's authority, execute with credentials, define the oracle that
decides a check), as a backstop to other mechanisms, and prefers to invert the
rule into an allowlist of safe categories where it can. The strength is medium:
no source is a solo operator with one identity. Reversibility ("corrections are
cheap") is the premise of the accounts that keep few gates; it fails for
secrets exposed by an executed workflow, for a published artefact, and for a
unique original with no other copy, which is where a path or capability rule
remains justified.

## 2. Trusted signals

All rows are **V**, quoted from GitHub documentation unless marked.

| Fact | Quotation and source |
| --- | --- |
| Anyone with write access can set a commit status | "Anyone with write permissions to a repository can set the state for any status check in the repository." <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks> |
| Check runs can be created only by a GitHub App | "Write permission for the REST API to interact with checks is only available to GitHub Apps. OAuth apps and authenticated users can view check runs and check suites, but they are not able to create them." <https://docs.github.com/en/rest/checks/runs> |
| A required check can be pinned to its source app | "Any person or integration with write permissions to a repository can set the state of any status check in the repository, but in some cases you may only want to accept a status check from a specific GitHub App." <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>; the ruleset field `integration_id` is documented at <https://docs.github.com/en/rest/repos/rules> |
| A skipped job counts as success | "A job that is skipped will report its status as "Success". It will not prevent a pull request from merging, even if it is a required check." (about-status-checks page above) |
| The REST merge can require the evaluated head | `sha`: "SHA that pull request head must match to allow merge." <https://docs.github.com/en/rest/pulls/pulls> |
| The GraphQL merge can, but only if asked | `expectedHeadOid`: "OID that the pull request head ref must match to allow merge; if omitted, no check is performed." <https://docs.github.com/public/fpt/schema.docs.graphql> |
| Comments can be edited by anyone with write access | "anyone with write access to a repository can edit comments on discussions, pull requests, and commits." <https://docs.github.com/en/communities/moderating-comments-and-conversations/managing-disruptive-comments> |
| Edits are visible in the GraphQL schema | `IssueComment` exposes `lastEditedAt`, `userContentEdits`, `editor` and `includesCreatedEdit` (field names in the schema file above) |
| One merge bot sends the evaluated head | `SHA: pr.HeadRefOID` in its merge call, so GitHub refuses if the head moved. <https://raw.githubusercontent.com/kubernetes-sigs/prow/main/pkg/tide/github.go> |

What follows from them (**I**):

- Preferring check runs to statuses is right when one identity can write
  everything: statuses fall to any write token, check runs to App tokens.
- Reading the check's source app, not only its name, is what mature mergers and
  GitHub's own rulesets do. A same-repository workflow can still produce a
  check under the Actions app with a chosen name; nothing in the documentation
  prevents it and it has not been tested (open question 28). The oracle files
  must therefore be held for check results to mean anything, and the relation
  runs one way.
- A comment has no commit field, so it is bound to a head only by text the bot
  writes into it; a review object carries the commit.
- "No findings" is not "clean": a vendor's reviewer documents that it flags
  only the highest priorities, that its review "never approves or blocks"
  (**V**, <https://code.claude.com/docs/en/code-review>), that by default its
  reviews "do not count toward required approvals" (**V**,
  <https://docs.github.com/en/copilot/concepts/agents/code-review>), and the
  Codex integration says "Codex flags only P0 and P1 issues" (**V**,
  <https://developers.openai.com/codex/integrations/github>).
- Reviewer behaviour on a push differs: some reviewers do not re-review
  (**V**, the Copilot page above: "it will only review a pull request once"
  unless configured). The gate must require the verdict's commit to equal the
  head and otherwise wait.
- A reviewer can be steered by content in the pull request. A preprint reports
  that "Every provider is susceptible to at least one high-severity attack in
  the tested configurations" (**V**, abstract, preprint,
  <https://arxiv.org/abs/2606.09935>). This is the reason a reviewer's verdict
  may only stop a merge, as the design already holds.
- A derived display status is a status, the least trustworthy signal under
  this identity; it is acceptable only as display, never as an input, and it
  adds a write surface. The owner keeps one such status for one consumer.

**What would need a second identity or a paid plan (V/I).** An agent credential
weaker than the owner's; protection and rulesets on private repositories;
environment protection on private repositories; attestations on private
repositories (<https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations>:
"If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, artifact
attestations are only available for public repositories."); merge queues
(organisation-owned repositories only); required workflows (enterprise).

## 3. Extensible per-repository policy

All items in this section are **S** (summarised) unless marked.

- **One expression language, data per repository.** Gerrit retired
  per-project Prolog rules in favour of one expression language for submit
  requirements: "Prolog rules are no longer supported in Gerrit."
  <https://gerrit-review.googlesource.com/Documentation/prolog-cookbook.html>.
  A child project may add requirements, and may override an inherited one
  unless the parent disallows overriding
  (<https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html>).
  Evaluation errors are a named state, not a pass (same page). The stated
  reason for retiring Prolog was only a simpler way for administrators to
  configure (I found no longer explanation).
- **Code once, data per use.** A policy-engine template is written once with a
  parameter schema and each repository supplies parameters:
  <https://open-policy-agent.github.io/gatekeeper/website/docs/howto/>.
- **Merge policy central, jobs in the repository.** One merge bot states that
  "updating a PR's `.prow.yaml` does not configure Tide context policies"
  (<https://docs.prow.k8s.io/docs/components/core/tide/config/>). A gating
  system's trusted configuration is "not used in testing the change":
  <https://zuul-ci.org/docs/zuul/latest/project-config.html>.
- **Where the policy is read from.** The code owners file from the base branch
  (above); a dependency bot's configuration from the default branch ("Renovate
  always uses the config from the repository's default branch,"
  <https://docs.renovatebot.com/configuration-options/>); GitHub moved
  `pull_request_target` to the default branch to shrink the places where stale
  or attacker-influenced policy can live
  (<https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/>).
  Security Lab on why: "by definition, a PR supplies code to any build or test
  logic in place for your project"
  (<https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/>).
- **Repository-supplied executable checks exist at scale, but behind a typed
  API.** Chromium's per-directory presubmit scripts and Google's analysis
  platform customise per project, not per person
  (<https://abseil.io/resources/swe-book/html/ch20.html>). A system that ran
  repository check code in a privileged context against pull request content
  was exploited (<https://securitylab.github.com/advisories/GHSL-2020-329-Automattic-jetpack-workflow>).
- **Process state lives in the scheduler, not in a per-pull-request check.**
  A merge bot's temporary hold is a human-set label on an open issue
  (<https://docs.prow.k8s.io/docs/components/core/tide/config/>); another bot's
  freeze is configuration that leaves one check pending
  (<https://docs.mergify.com/merge-protections/freeze>); dependency bots cap
  their own open pull requests
  (<https://docs.renovatebot.com/configuration-options/>). No tool was found
  that natively pauses automation while any human-authored pull request is
  open.
- **Fail-closed has to be written.** Claude Code hooks proceed on most
  non-zero exits unless the hook is configured to block on failure:
  <https://code.claude.com/docs/en/hooks-guide>.

**Conclusion (I).** Mature systems keep repository variety in data and a
shared evaluator, keep trusted policy where the change under review cannot edit
it, and put process state in the scheduler or the queue. A repository-supplied
script behind a gate is the strongest extension point on the list, so it is the
last resort, with the contract recorded in
[design section 11.1](../design.md#111-recorded-contract-extra_check).

## 4. Disagreements and gaps

- The vendor documents that its auto mode blocks "Merging a pull request no
  human has approved" by default (**S**,
  <https://code.claude.com/docs/en/permission-modes>), yet the kit's
  unattended runner merges its own pull requests. How that configuration
  permits it is not known; a classifier change could stop runner merges.
- Two reported miss rates for the auto-mode classifier conflict and were not
  adjudicated; nothing in the design depends on either.
- Whether a workflow in a pull request can forge a named check is untested
  (open question 28). Whether the reviewer's summary edits are attributable is
  untested (open question 29).
- Quotations marked **S** should be re-read from the page before reuse.

## 5. How this maps to the decisions

| Decision of 2026-11-22 | Outside basis | Strength |
| --- | --- | --- |
| Runner lanes are allowlists with default hold; floor by class | Backstop lists plus category allowlists; classes of harm that a revert does not undo | Medium; transfer is **I** |
| Two homes, three readers | Policy read from one place the change cannot edit; single source | Medium |
| Declarative content rules first | One expression language, data per repository; trusted policy not self-tested | Medium-high on location, medium on the interface |
| Merge-time policy does not stop pre-merge execution | Same-repository workflows run from the merge commit with chosen permissions (**V**) | High |
| Trusted signals unchanged | Statuses writable by any write token; check runs only by Apps; merge with evaluated head (**V**) | High on direction; the forging question is untested |
| Process state outside content rules | Process state lives in the scheduler; no per-pull-request script found | Medium |
| No boundary under one admin identity | Every separation found needs a second identity and a second approver (**V**) | High |
