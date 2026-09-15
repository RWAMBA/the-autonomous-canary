# Live demonstration

## Live demonstration safety

Use a temporary terminal environment for credentials. Never put a key in a URL, command history, recording, screenshot, source file, or browser storage. The public walkthrough needs no credential; authenticated evidence must be demonstrated privately.

## Public walkthrough

1. Open `/case-study` and explain the Problem statement and status vocabulary.
2. Open `/architecture` and trace verified input → normalized evidence → Deterministic policy authority → outcome.
3. On `/`, use the fixed interactive demo scenarios:
   - clean release: low risk and `CONTINUE`;
   - failed tests: `BLOCK`;
   - critical secret: `BLOCK`.
4. Open `/management`. Show that the shell is public but release evidence is not anonymously disclosed.

## Authenticated release walkthrough

The operator loads the API key with hidden terminal input, exports it only for the process, and unsets it after the demonstration. Use the documented management endpoints to:

1. list the exact repository release;
2. show pull-request identity, predicted risk, final decision, strategy, and outcome together;
3. open bounded evidence details and audit events;
4. export the versioned `canaryguard-evidence-report-v1` attachment; and
5. confirm that another tenant cannot enumerate or read the release.

## Safe pull request demonstration

Use a pull request whose required workflow and jobs succeeded and whose normalized findings contain no blocking condition. Expected result: `CONTINUE`, `STANDARD`, 100% initial traffic, successful Check Run, and a recorded successful outcome.

## Unsafe pull request demonstration

Use a fixture or closed demonstration pull request with a failed CI job or critical secret finding. Expected result: `BLOCK`, `BLOCKED`, 0% initial traffic, a failed Check Run, and no deployment execution.

## Canary simulation

Use the repository rollout tests or local Compose stack—not production traffic—to show:

- Canary continuation: healthy observations keep the attempt in observation with `CONTINUED`.
- Canary rollback: an error-rate or latency threshold breach produces `ROLLED_BACK` and restores stable routing.

The simulation must be described as deterministically tested, not production-validated, unless a real production canary attempt is separately evidenced.
