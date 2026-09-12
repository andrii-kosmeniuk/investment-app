# Autonomous-agent boundaries

Agents may read portfolio, performance, transactions, tax lots, and reconciliation
breaks. Their only writes create pending approval requests.

Agents must never:

- Approve or reject requests - regulated attribution and separation of duties require a human.
- Submit, replace, or cancel broker orders directly - execution is consequential and difficult to reverse.
- Initiate a provider transfer - moving money requires explicit human intent.
- Change a linked bank account - account substitution is a high-risk fraud surface.
- Override KYC or trading restrictions - an agent is not a compliance decision-maker.
- Post reversals or reconciliation adjustments - accounting corrections require attributable review.
- Mark a reconciliation break resolved - resolution requires evidence and, sometimes, a journal entry.
- Change model weights, cash buffers, thresholds, or tolerances - these are controlled product policy.
- Read or rotate provider secrets - prompts and tool output are exfiltration surfaces.

The MCP transport authenticates agents separately from users. Database constraints
enforce human-only approval even if an application client is compromised.
