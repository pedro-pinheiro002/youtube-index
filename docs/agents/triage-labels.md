# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Type labels (not triage)

Some labels describe the *kind* of issue rather than its triage state. These stack on top of a triage label and never replace it.

| Label    | Meaning                                                                 |
| -------- | ----------------------------------------------------------------------- |
| `spec`   | Published spec — end-to-end problem statement, solution, user stories, implementation/test decisions. Exclusively for issues created by `/to-spec` (or hand-written specs). Never applied to tickets created by `/to-tickets`. |

Apply the `spec` label only when an issue documents a desired behavior change end-to-end (problem statement, solution, user stories, implementation/test decisions). `/to-spec` adds it automatically. `/to-tickets` does **not** — tickets are derived from a spec, not specs themselves, so a ticket is recognizable by the absence of `spec`. If a spec issue is later broken into tickets via `/to-tickets`, the parent spec keeps `spec`; the tickets keep only `ready-for-agent` (plus any triage they need).
