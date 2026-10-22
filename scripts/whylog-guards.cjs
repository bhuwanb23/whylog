#!/usr/bin/env node
/*
 * Emitted by the WhyLog export compiler alongside CLAUDE.md / AGENTS.md / DECISIONS.md.
 *
 * Those documents contain `Verify:` lines of the form:
 *     node scripts/whylog-guards.cjs --decision WLD-0007
 * This file is what makes those lines true. It is compiled from the same graph in the same
 * pass, so a verify command cannot name a guard this runner does not have.
 *
 * Log head: 1dc9ff58cd1d09
 * Guards:   53
 *
 * Re-export after any change to the log. Editing this file by hand is detected as a stamp
 * mismatch, and the edit is lost on the next export.
 */
/**
 * WhyLog decision guards — generated. Do not edit by hand.
 *
 * Log head: 1dc9ff58cd1d09
 * Guards:   53
 *
 * Exits non-zero if any BLOCKING guard fails. Warning failures are printed
 * as advice and do not affect the exit code.
 *
 * Re-export from the app after any change to the log: the guard set below is
 * frozen at export time, and so are the premise labels in each failure message.
 */

const fs = require("node:fs");
const path = require("node:path");

const GUARDS = [
  {
    "id": "G-00010",
    "decisionId": "WLD-0001",
    "statement": "Use postgres",
    "kind": "dependency_present",
    "target": "pg",
    "severity": "blocking",
    "rationale": "WLD-0001 chose postgres, so a postgres driver must be in the dependency tree. `pg` is the usual one; postgres, postgresql, @neondatabase/serverless, drizzle-orm would also satisfy the decision, and if you use one of those, edit this guard rather than suppressing it.",
    "spec": {
      "kind": "dependency_present",
      "package": "pg",
      "includeDev": false
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0001",
        "text": "I need somewhere to put decisions,",
        "label": "IN"
      },
      {
        "id": "P-0002",
        "text": "It contains 6 extractable decisions, one of which (Postgres, Oct 3) is the trap",
        "label": "OUT"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "Supabase?"
    ]
  },
  {
    "id": "G-00011",
    "decisionId": "WLD-0001",
    "statement": "Use postgres",
    "kind": "dependency_present",
    "target": "postgres",
    "severity": "warning",
    "rationale": "WLD-0001 settled DATABASE on postgres, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "postgres",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0001",
        "text": "I need somewhere to put decisions,",
        "label": "IN"
      },
      {
        "id": "P-0002",
        "text": "It contains 6 extractable decisions, one of which (Postgres, Oct 3) is the trap",
        "label": "OUT"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "Supabase?"
    ]
  },
  {
    "id": "G-00012",
    "decisionId": "WLD-0001",
    "statement": "Use postgres",
    "kind": "dependency_absent",
    "target": "better-sqlite3",
    "severity": "blocking",
    "rationale": "`better-sqlite3` is mutually exclusive with postgres under DATABASE, which WLD-0001 settled. Its presence would mean the decision has been reversed in code without being reversed in the log.",
    "spec": {
      "kind": "dependency_absent",
      "package": "better-sqlite3",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0001",
        "text": "I need somewhere to put decisions,",
        "label": "IN"
      },
      {
        "id": "P-0002",
        "text": "It contains 6 extractable decisions, one of which (Postgres, Oct 3) is the trap",
        "label": "OUT"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "Supabase?"
    ]
  },
  {
    "id": "G-00020",
    "decisionId": "WLD-0002",
    "statement": "Use sqlite, not pos or postgres",
    "kind": "dependency_present",
    "target": "sqlite",
    "severity": "warning",
    "rationale": "WLD-0002 settled SCOPE on sqlite, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "sqlite",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0004",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0010",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "post",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      },
      {
        "value": "postgres",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "here?"
    ]
  },
  {
    "id": "G-00021",
    "decisionId": "WLD-0002",
    "statement": "Use sqlite, not pos or postgres",
    "kind": "dependency_absent",
    "target": "post",
    "severity": "blocking",
    "rationale": "WLD-0002 rejected post — \"so no async ceremony everywhere, zero deploy\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "post",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0004",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0010",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "post",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      },
      {
        "value": "postgres",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "here?"
    ]
  },
  {
    "id": "G-00022",
    "decisionId": "WLD-0002",
    "statement": "Use sqlite, not pos or postgres",
    "kind": "dependency_absent",
    "target": "postgres",
    "severity": "blocking",
    "rationale": "WLD-0002 rejected postgres — \"so no async ceremony everywhere, zero deploy\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "postgres",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0004",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0010",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "post",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      },
      {
        "value": "postgres",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "here?"
    ]
  },
  {
    "id": "G-00030",
    "decisionId": "WLD-0003",
    "statement": "Use single, not async ceremony",
    "kind": "dependency_present",
    "target": "single",
    "severity": "warning",
    "rationale": "WLD-0003 settled SCOPE on single, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "single",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0004",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0010",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "async",
        "whyRejected": "ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "here?"
    ]
  },
  {
    "id": "G-00031",
    "decisionId": "WLD-0003",
    "statement": "Use single, not async ceremony",
    "kind": "dependency_absent",
    "target": "async",
    "severity": "blocking",
    "rationale": "WLD-0003 rejected async — \"ceremony everywhere, zero deploy\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "async",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0004",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0010",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "async",
        "whyRejected": "ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "here?"
    ]
  },
  {
    "id": "G-00032",
    "decisionId": "WLD-0003",
    "statement": "Use single, not async ceremony",
    "kind": "path_glob_exists",
    "target": "here?",
    "severity": "warning",
    "rationale": "WLD-0003 declares that it governs `here?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to SCOPE.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "here?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0004",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0010",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "async",
        "whyRejected": "ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "here?"
    ]
  },
  {
    "id": "G-00040",
    "decisionId": "WLD-0004",
    "statement": "Use multi-user, not postgres for or postgres",
    "kind": "dependency_present",
    "target": "multi-user",
    "severity": "warning",
    "rationale": "WLD-0004 settled DATABASE on multi-user, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "multi-user",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "postgres",
        "whyRejected": "because the schema is small"
      },
      {
        "value": "postgres",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00041",
    "decisionId": "WLD-0004",
    "statement": "Use multi-user, not postgres for or postgres",
    "kind": "dependency_absent",
    "target": "postgres",
    "severity": "blocking",
    "rationale": "WLD-0004 rejected postgres — \"because the schema is small\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "postgres",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "postgres",
        "whyRejected": "because the schema is small"
      },
      {
        "value": "postgres",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00042",
    "decisionId": "WLD-0004",
    "statement": "Use multi-user, not postgres for or postgres",
    "kind": "path_glob_exists",
    "target": "auth?",
    "severity": "warning",
    "rationale": "WLD-0004 declares that it governs `auth?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to DATABASE.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "auth?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "postgres",
        "whyRejected": "because the schema is small"
      },
      {
        "value": "postgres",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00050",
    "decisionId": "WLD-0005",
    "statement": "Use sqlite, not postgres for or postgres",
    "kind": "dependency_present",
    "target": "better-sqlite3",
    "severity": "blocking",
    "rationale": "WLD-0005 chose sqlite, so a sqlite driver must be in the dependency tree. `better-sqlite3` is the usual one; sql.js, libsql, @libsql/client, sqlite3 would also satisfy the decision, and if you use one of those, edit this guard rather than suppressing it.",
    "spec": {
      "kind": "dependency_present",
      "package": "better-sqlite3",
      "includeDev": false
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00051",
    "decisionId": "WLD-0005",
    "statement": "Use sqlite, not postgres for or postgres",
    "kind": "dependency_present",
    "target": "sqlite",
    "severity": "warning",
    "rationale": "WLD-0005 settled DATABASE on sqlite, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "sqlite",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00052",
    "decisionId": "WLD-0005",
    "statement": "Use sqlite, not postgres for or postgres",
    "kind": "dependency_absent",
    "target": "pg",
    "severity": "blocking",
    "rationale": "`pg` is mutually exclusive with sqlite under DATABASE, which WLD-0005 settled. Its presence would mean the decision has been reversed in code without being reversed in the log.",
    "spec": {
      "kind": "dependency_absent",
      "package": "pg",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00060",
    "decisionId": "WLD-0006",
    "statement": "Use single-user, not postgres for or postgres",
    "kind": "dependency_present",
    "target": "single-user",
    "severity": "warning",
    "rationale": "WLD-0006 settled DATABASE on single-user, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "single-user",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00061",
    "decisionId": "WLD-0006",
    "statement": "Use single-user, not postgres for or postgres",
    "kind": "path_glob_exists",
    "target": "auth?",
    "severity": "warning",
    "rationale": "WLD-0006 declares that it governs `auth?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to DATABASE.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "auth?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00062",
    "decisionId": "WLD-0006",
    "statement": "Use single-user, not postgres for or postgres",
    "kind": "path_glob_exists",
    "target": "machine?",
    "severity": "warning",
    "rationale": "WLD-0006 declares that it governs `machine?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to DATABASE.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "machine?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00070",
    "decisionId": "WLD-0007",
    "statement": "Use schema",
    "kind": "dependency_present",
    "target": "schema",
    "severity": "warning",
    "rationale": "WLD-0007 settled AUTH on schema, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "schema",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00071",
    "decisionId": "WLD-0007",
    "statement": "Use schema",
    "kind": "path_glob_exists",
    "target": "auth?",
    "severity": "warning",
    "rationale": "WLD-0007 declares that it governs `auth?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to AUTH.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "auth?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00072",
    "decisionId": "WLD-0007",
    "statement": "Use schema",
    "kind": "path_glob_exists",
    "target": "machine?",
    "severity": "warning",
    "rationale": "WLD-0007 declares that it governs `machine?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to AUTH.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "machine?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00080",
    "decisionId": "WLD-0008",
    "statement": "Use local",
    "kind": "dependency_present",
    "target": "local",
    "severity": "warning",
    "rationale": "WLD-0008 settled AUTH on local, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "local",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00081",
    "decisionId": "WLD-0008",
    "statement": "Use local",
    "kind": "path_glob_exists",
    "target": "auth?",
    "severity": "warning",
    "rationale": "WLD-0008 declares that it governs `auth?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to AUTH.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "auth?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00082",
    "decisionId": "WLD-0008",
    "statement": "Use local",
    "kind": "path_glob_exists",
    "target": "machine?",
    "severity": "warning",
    "rationale": "WLD-0008 declares that it governs `machine?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to AUTH.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "machine?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "machine?"
    ]
  },
  {
    "id": "G-00090",
    "decisionId": "WLD-0009",
    "statement": "Use auth, not login",
    "kind": "dependency_present",
    "target": "auth",
    "severity": "warning",
    "rationale": "WLD-0009 settled AUTH on auth, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "auth",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "login",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "machine?"
    ]
  },
  {
    "id": "G-00091",
    "decisionId": "WLD-0009",
    "statement": "Use auth, not login",
    "kind": "dependency_absent",
    "target": "login",
    "severity": "blocking",
    "rationale": "WLD-0009 rejected login. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "login",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "login",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "machine?"
    ]
  },
  {
    "id": "G-00092",
    "decisionId": "WLD-0009",
    "statement": "Use auth, not login",
    "kind": "path_glob_exists",
    "target": "machine?",
    "severity": "warning",
    "rationale": "WLD-0009 declares that it governs `machine?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to AUTH.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "machine?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0005",
        "text": "What's the actual concurrency requirement here",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "OUT"
      },
      {
        "id": "P-0007",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
      },
      {
        "id": "P-0009",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0012",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "login",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "machine?"
    ]
  },
  {
    "id": "G-00100",
    "decisionId": "WLD-0010",
    "statement": "Use hackathon",
    "kind": "dependency_present",
    "target": "hackathon",
    "severity": "warning",
    "rationale": "WLD-0010 settled OTHER on hackathon, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "hackathon",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "re-litigate",
        "whyRejected": "so we don't"
      }
    ],
    "appliesTo": [
      "presence?"
    ]
  },
  {
    "id": "G-00101",
    "decisionId": "WLD-0010",
    "statement": "Use hackathon",
    "kind": "dependency_absent",
    "target": "re-litigate",
    "severity": "blocking",
    "rationale": "WLD-0010 rejected re-litigate — \"so we don't\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "re-litigate",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "re-litigate",
        "whyRejected": "so we don't"
      }
    ],
    "appliesTo": [
      "presence?"
    ]
  },
  {
    "id": "G-00102",
    "decisionId": "WLD-0010",
    "statement": "Use hackathon",
    "kind": "path_glob_exists",
    "target": "presence?",
    "severity": "warning",
    "rationale": "WLD-0010 declares that it governs `presence?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to OTHER.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "presence?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "re-litigate",
        "whyRejected": "so we don't"
      }
    ],
    "appliesTo": [
      "presence?"
    ]
  },
  {
    "id": "G-00110",
    "decisionId": "WLD-0011",
    "statement": "Use single",
    "kind": "dependency_present",
    "target": "single",
    "severity": "warning",
    "rationale": "WLD-0011 settled ARCHITECTURE on single, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "single",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0020",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "local",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "presence?"
    ]
  },
  {
    "id": "G-00111",
    "decisionId": "WLD-0011",
    "statement": "Use single",
    "kind": "dependency_absent",
    "target": "local",
    "severity": "blocking",
    "rationale": "WLD-0011 rejected local. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "local",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0020",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "local",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "presence?"
    ]
  },
  {
    "id": "G-00112",
    "decisionId": "WLD-0011",
    "statement": "Use single",
    "kind": "path_glob_exists",
    "target": "presence?",
    "severity": "warning",
    "rationale": "WLD-0011 declares that it governs `presence?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to ARCHITECTURE.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "presence?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0020",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "local",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "presence?"
    ]
  },
  {
    "id": "G-00120",
    "decisionId": "WLD-0012",
    "statement": "Use single-page, not server-side sur",
    "kind": "dependency_present",
    "target": "single-page",
    "severity": "warning",
    "rationale": "WLD-0012 settled FRAMEWORK on single-page, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "single-page",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0020",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "server-side",
        "whyRejected": "so search works"
      },
      {
        "value": "next",
        "whyRejected": "so search works"
      }
    ],
    "appliesTo": [
      "presence?",
      "works?"
    ]
  },
  {
    "id": "G-00121",
    "decisionId": "WLD-0012",
    "statement": "Use single-page, not server-side sur",
    "kind": "dependency_absent",
    "target": "server-side",
    "severity": "blocking",
    "rationale": "WLD-0012 rejected server-side — \"so search works\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "server-side",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0020",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "server-side",
        "whyRejected": "so search works"
      },
      {
        "value": "next",
        "whyRejected": "so search works"
      }
    ],
    "appliesTo": [
      "presence?",
      "works?"
    ]
  },
  {
    "id": "G-00122",
    "decisionId": "WLD-0012",
    "statement": "Use single-page, not server-side sur",
    "kind": "dependency_absent",
    "target": "next",
    "severity": "blocking",
    "rationale": "WLD-0012 rejected next — \"so search works\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "next",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0020",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "server-side",
        "whyRejected": "so search works"
      },
      {
        "value": "next",
        "whyRejected": "so search works"
      }
    ],
    "appliesTo": [
      "presence?",
      "works?"
    ]
  },
  {
    "id": "G-00130",
    "decisionId": "WLD-0013",
    "statement": "Use tailwind, not next. how or next",
    "kind": "dependency_present",
    "target": "tailwind",
    "severity": "warning",
    "rationale": "WLD-0013 settled FRAMEWORK on tailwind, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "tailwind",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0020",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "next. how",
        "whyRejected": null
      },
      {
        "value": "next",
        "whyRejected": "hosted version"
      },
      {
        "value": "next.js",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "works?"
    ]
  },
  {
    "id": "G-00131",
    "decisionId": "WLD-0013",
    "statement": "Use tailwind, not next. how or next",
    "kind": "dependency_absent",
    "target": "next",
    "severity": "blocking",
    "rationale": "WLD-0013 rejected next — \"hosted version\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "next",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0020",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "next. how",
        "whyRejected": null
      },
      {
        "value": "next",
        "whyRejected": "hosted version"
      },
      {
        "value": "next.js",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "works?"
    ]
  },
  {
    "id": "G-00132",
    "decisionId": "WLD-0013",
    "statement": "Use tailwind, not next. how or next",
    "kind": "dependency_absent",
    "target": "next.js",
    "severity": "blocking",
    "rationale": "WLD-0013 rejected next.js. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "next.js",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
        "label": "OUT"
      },
      {
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0020",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0022",
        "text": "I'll note that as a deliberate decision so we don't",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "next. how",
        "whyRejected": null
      },
      {
        "value": "next",
        "whyRejected": "hosted version"
      },
      {
        "value": "next.js",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "works?"
    ]
  },
  {
    "id": "G-00140",
    "decisionId": "WLD-0014",
    "statement": "Use embeddings, not 200 vectors or 200",
    "kind": "dependency_present",
    "target": "embeddings",
    "severity": "warning",
    "rationale": "WLD-0014 settled RETRIEVAL on embeddings, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "embeddings",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "200",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "realistically?",
      "extractor?"
    ]
  },
  {
    "id": "G-00141",
    "decisionId": "WLD-0014",
    "statement": "Use embeddings, not 200 vectors or 200",
    "kind": "dependency_absent",
    "target": "200",
    "severity": "blocking",
    "rationale": "WLD-0014 rejected 200. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "200",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "200",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "realistically?",
      "extractor?"
    ]
  },
  {
    "id": "G-00142",
    "decisionId": "WLD-0014",
    "statement": "Use embeddings, not 200 vectors or 200",
    "kind": "path_glob_exists",
    "target": "realistically?",
    "severity": "warning",
    "rationale": "WLD-0014 declares that it governs `realistically?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to RETRIEVAL.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "realistically?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "200",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "realistically?",
      "extractor?"
    ]
  },
  {
    "id": "G-00150",
    "decisionId": "WLD-0015",
    "statement": "Use infra",
    "kind": "dependency_present",
    "target": "infra",
    "severity": "warning",
    "rationale": "WLD-0015 settled OTHER on infra, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "infra",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "sub-millisecond",
        "whyRejected": null
      },
      {
        "value": "testing",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "extractor?"
    ]
  },
  {
    "id": "G-00151",
    "decisionId": "WLD-0015",
    "statement": "Use infra",
    "kind": "dependency_absent",
    "target": "sub-millisecond",
    "severity": "blocking",
    "rationale": "WLD-0015 rejected sub-millisecond. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "sub-millisecond",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "sub-millisecond",
        "whyRejected": null
      },
      {
        "value": "testing",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "extractor?"
    ]
  },
  {
    "id": "G-00152",
    "decisionId": "WLD-0015",
    "statement": "Use infra",
    "kind": "dependency_absent",
    "target": "testing",
    "severity": "blocking",
    "rationale": "WLD-0015 rejected testing. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "testing",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "sub-millisecond",
        "whyRejected": null
      },
      {
        "value": "testing",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "extractor?"
    ]
  },
  {
    "id": "G-00160",
    "decisionId": "WLD-0016",
    "statement": "Use text-in, not doing full",
    "kind": "dependency_present",
    "target": "text-in",
    "severity": "warning",
    "rationale": "WLD-0016 settled OTHER on text-in, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "text-in",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "doing",
        "whyRejected": "I write unit tests for the extractor"
      }
    ],
    "appliesTo": [
      "extractor?"
    ]
  },
  {
    "id": "G-00161",
    "decisionId": "WLD-0016",
    "statement": "Use text-in, not doing full",
    "kind": "dependency_absent",
    "target": "doing",
    "severity": "blocking",
    "rationale": "WLD-0016 rejected doing — \"I write unit tests for the extractor\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "doing",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "doing",
        "whyRejected": "I write unit tests for the extractor"
      }
    ],
    "appliesTo": [
      "extractor?"
    ]
  },
  {
    "id": "G-00162",
    "decisionId": "WLD-0016",
    "statement": "Use text-in, not doing full",
    "kind": "path_glob_exists",
    "target": "extractor?",
    "severity": "warning",
    "rationale": "WLD-0016 declares that it governs `extractor?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to OTHER.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "extractor?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "doing",
        "whyRejected": "I write unit tests for the extractor"
      }
    ],
    "appliesTo": [
      "extractor?"
    ]
  },
  {
    "id": "G-00170",
    "decisionId": "WLD-0017",
    "statement": "Use cheap, not doing full",
    "kind": "dependency_present",
    "target": "cheap",
    "severity": "warning",
    "rationale": "WLD-0017 settled OTHER on cheap, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "cheap",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "extractor?"
    ]
  },
  {
    "id": "G-00171",
    "decisionId": "WLD-0017",
    "statement": "Use cheap, not doing full",
    "kind": "path_glob_exists",
    "target": "extractor?",
    "severity": "warning",
    "rationale": "WLD-0017 declares that it governs `extractor?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to OTHER.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "extractor?"
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "extractor?"
    ]
  },
  {
    "id": "G-00180",
    "decisionId": "WLD-0018",
    "statement": "Use golden-file, not ui test",
    "kind": "dependency_present",
    "target": "golden-file",
    "severity": "warning",
    "rationale": "WLD-0018 settled TESTING on golden-file, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "golden-file",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0024",
        "text": "I don't have time",
        "label": "IN"
      },
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0026",
        "text": "the UI is throwaway for the demo",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0028",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "ui",
        "whyRejected": null
      }
    ],
    "appliesTo": []
  },
  {
    "id": "G-00181",
    "decisionId": "WLD-0018",
    "statement": "Use golden-file, not ui test",
    "kind": "dependency_absent",
    "target": "ui",
    "severity": "blocking",
    "rationale": "WLD-0018 rejected ui. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "ui",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0024",
        "text": "I don't have time",
        "label": "IN"
      },
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0026",
        "text": "the UI is throwaway for the demo",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0028",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "ui",
        "whyRejected": null
      }
    ],
    "appliesTo": []
  },
  {
    "id": "G-00190",
    "decisionId": "WLD-0019",
    "statement": "Use fixture, not ui test",
    "kind": "dependency_present",
    "target": "fixture",
    "severity": "warning",
    "rationale": "WLD-0019 settled TESTING on fixture, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "fixture",
      "includeDev": true
    },
    "decidedAt": "2026-10-22",
    "restsOn": [
      {
        "id": "P-0024",
        "text": "I don't have time",
        "label": "IN"
      },
      {
        "id": "P-0025",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0026",
        "text": "the UI is throwaway for the demo",
        "label": "IN"
      },
      {
        "id": "P-0027",
        "text": "reasoning: dozens of decisions, sub-ms scan, no infra",
        "label": "IN"
      },
      {
        "id": "P-0028",
        "text": "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        "label": "IN"
      },
      {
        "id": "P-0029",
        "text": "how many decisions are we talking about realistically",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": []
  }
];


/* ---------------------------------------------------------------- project -- */

function readManifest() {
  try {
    const raw = JSON.parse(fs.readFileSync("package.json", "utf8"));
    return {
      dependencies: raw.dependencies || {},
      devDependencies: raw.devDependencies || {},
    };
  } catch {
    return { dependencies: {}, devDependencies: {} };
  }
}

function listFiles(dir, out) {
  out = out || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full.split(path.sep).join("/"));
  }
  return out;
}

function readFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------- glob -- */
/* Transcribed from src/lib/glob.ts so results match the in-browser run.      */

function globToRegExpSource(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; }
        else { out += ".*"; i += 1; }
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === ".") out += "\\.";
    else if ("+^${}|()[]".includes(c)) out += "\\" + c;
    else out += c;
  }
  return out;
}

function matchesGlob(p, glob) {
  return new RegExp("^" + globToRegExpSource(glob) + "$").test(p);
}

/* Word boundaries ON by default: a bare substring match on "pg" hits "pgp",   */
/* "pgsql-tools" and any passing mention in a comment.                        */
function compilePattern(pattern, wordBoundary, caseSensitive) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = wordBoundary === false ? escaped : "\\b" + escaped + "\\b";
  return new RegExp(source, caseSensitive ? "g" : "gi");
}

function findMatchInText(text, pattern, wordBoundary, caseSensitive) {
  const re = compilePattern(pattern, wordBoundary, caseSensitive);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    re.lastIndex = 0;
    if (re.test(lines[i])) return { line: i + 1, text: lines[i].trim() };
  }
  return null;
}

/* ---------------------------------------------------------------- evaluate -- */

function evaluate(guard, project) {
  const spec = guard.spec;

  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent": {
      /* Same asymmetry as the browser: an ABSENCE check covers devDependencies, because a
       * rejected package installed for tooling is still installed. A PRESENCE check does not,
       * because a build-only dependency does not mean the decision was implemented. */
      const includeDev = spec.includeDev === undefined
        ? spec.kind === "dependency_absent"
        : spec.includeDev;

      const inRuntime = project.dependencies[spec.package];
      const inDev = includeDev ? project.devDependencies[spec.package] : undefined;
      const version = inRuntime !== undefined ? inRuntime : inDev;
      const where = inRuntime !== undefined ? "dependencies" : "devDependencies";

      if (spec.kind === "dependency_present") {
        return version === undefined
          ? { outcome: "fail", evidence: '"' + spec.package + '" is not in package.json' + (includeDev ? " (checked dependencies and devDependencies)" : " (checked dependencies only)") }
          : { outcome: "pass", evidence: '"' + spec.package + '": "' + version + '" is present in ' + where };
      }
      return version !== undefined
        ? { outcome: "fail", evidence: '"' + spec.package + '": "' + version + '" found in package.json ' + where }
        : { outcome: "pass", evidence: '"' + spec.package + '" does not appear in package.json' };
    }

    case "path_glob_exists":
    case "path_glob_absent": {
      const matches = project.files.filter((f) => matchesGlob(f, spec.glob));
      if (spec.kind === "path_glob_exists") {
        return matches.length === 0
          ? { outcome: "fail", evidence: "No file matches `" + spec.glob + "` among " + project.files.length + " path(s)" }
          : { outcome: "pass", evidence: matches.length + " file(s) match `" + spec.glob + "`: " + matches.slice(0, 6).join(", ") };
      }
      return matches.length > 0
        ? { outcome: "fail", evidence: matches.length + " file(s) match `" + spec.glob + "` but none should: " + matches.slice(0, 6).join(", ") }
        : { outcome: "pass", evidence: "No file matches `" + spec.glob + "`" };
    }

    case "string_in_files":
    case "string_absent_in_files": {
      const scoped = project.files.filter((f) => matchesGlob(f, spec.glob));
      if (scoped.length === 0) {
        return { outcome: "skip", evidence: "no file matches the scope `" + spec.glob + "`" };
      }
      const wordBoundary = spec.wordBoundary === undefined ? true : spec.wordBoundary;
      const caseSensitive = spec.caseSensitive === undefined ? false : spec.caseSensitive;

      for (const file of scoped) {
        const text = readFile(file);
        if (text === undefined) continue;
        const hit = findMatchInText(text, spec.pattern, wordBoundary, caseSensitive);
        if (hit === null) continue;

        const where = file + ":" + hit.line;
        const quoted = JSON.stringify(hit.text.length > 160 ? hit.text.slice(0, 157) + "..." : hit.text);
        if (spec.kind === "string_absent_in_files") {
          return { outcome: "fail", evidence: '"' + spec.pattern + '" found at ' + where + " — " + quoted };
        }
        return { outcome: "pass", evidence: '"' + spec.pattern + '" found at ' + where + " — " + quoted };
      }

      if (spec.kind === "string_in_files") {
        return { outcome: "fail", evidence: '"' + spec.pattern + '" does not appear in ' + scoped.length + " file(s) matching `" + spec.glob + "`" };
      }
      return { outcome: "pass", evidence: '"' + spec.pattern + '" does not appear in ' + scoped.length + " file(s) matching `" + spec.glob + "`" };
    }

    case "command_exit_zero": {
      /* CI has a shell, which the browser does not. This is the one kind whose result can
       * legitimately differ between the two targets, and it is environment-dependent by
       * nature — which is why it is never `blocking` by default. */
      try {
        const { execSync } = require("node:child_process");
        execSync(spec.command, { stdio: "pipe", cwd: spec.cwd || "." });
        return { outcome: "pass", evidence: "`" + spec.command + "` exited 0" };
      } catch (error) {
        const out = (error.stdout || error.stderr || "").toString().trim().split("\n")[0] || "";
        return { outcome: "fail", evidence: "`" + spec.command + "` exited non-zero" + (out ? ": " + out : "") };
      }
    }

    default:
      return { outcome: "skip", evidence: "kind " + spec.kind + " cannot run in CI without a model" };
  }
}

/* ----------------------------------------------------------------- report -- */
/* The failure message is the product. It does the job of an ADR, a code-review */
/* comment and an onboarding document, at the moment it is useful.             */

function reportFailure(guard, result) {
  const lines = [];
  lines.push("");
  lines.push("\x1b[31m\u2717 " + guard.decisionId + " \u2014 " + guard.statement + "\x1b[0m");
  lines.push("  Guard " + guard.id + " (" + guard.kind + ": " + guard.target + ") FAILED  [" + guard.severity + "]");
  lines.push("  Evidence: " + result.evidence);
  lines.push("  Why this check verifies that decision: " + guard.rationale);

  const premises = guard.restsOn.length === 0
    ? "nothing recorded"
    : guard.restsOn.map((p) => p.id + " " + p.text + " (" + p.label + ")").join(", ");
  lines.push("  Decided: " + guard.decidedAt + " \u00b7 Rests on: " + premises);

  if (guard.restsOn.length === 0) {
    lines.push("    (no recorded premise, so nothing can falsify it \u2014 a gap worth filling in WhyLog)");
  }

  for (const alt of guard.rejected) {
    lines.push("  Rejected alternative " + alt.value + (alt.whyRejected ? " \u2014 reason: \"" + alt.whyRejected + "\"" : " \u2014 no reason recorded"));
  }

  lines.push("");
  lines.push("  \u2192 Is this a deliberate reversal?   Record it in WhyLog so the log stops claiming otherwise.");
  lines.push("  \u2192 Or is this drift?                Undo the change: " + undoHint(guard));
  return lines.join("\n");
}

function undoHint(guard) {
  switch (guard.kind) {
    case "dependency_absent": return "remove the \"" + guard.target + "\" dependency.";
    case "dependency_present": return "install \"" + guard.target + "\", or record the decision that replaced it.";
    case "path_glob_absent": return "remove the file(s) matching \"" + guard.target + "\".";
    case "path_glob_exists": return "restore the file(s) matching \"" + guard.target + "\".";
    case "string_absent_in_files": return "remove \"" + guard.target + "\" from the files in scope.";
    case "string_in_files": return "add \"" + guard.target + "\" where the decision expects it.";
    default: return "see the guard's rationale above.";
  }
}

/* -------------------------------------------------------------------- main -- */

function main() {
  const manifest = readManifest();
  const files = listFiles(".");
  const project = { dependencies: manifest.dependencies, devDependencies: manifest.devDependencies, files: files };

  console.log("WhyLog decision guards \u00b7 " + GUARDS.length + " guard(s) \u00b7 " + files.length + " file(s) scanned");

  let blocking = 0;
  let warnings = 0;
  let passed = 0;
  let skipped = 0;

  for (const guard of GUARDS) {
    const result = evaluate(guard, project);

    if (result.outcome === "pass") { passed += 1; continue; }
    if (result.outcome === "skip") {
      skipped += 1;
      console.log("\x1b[33m\u2013 " + guard.id + " SKIPPED\x1b[0m (" + guard.kind + ": " + guard.target + ") \u2014 " + result.evidence);
      continue;
    }

    if (guard.severity === "blocking") blocking += 1;
    else warnings += 1;

    console.log(reportFailure(guard, result));
  }

  console.log("");
  console.log("  passed " + passed + " \u00b7 failed " + (blocking + warnings) + " (" + blocking + " blocking, " + warnings + " warning) \u00b7 skipped " + skipped);

  if (blocking > 0) {
    console.log("\n\x1b[31m" + blocking + " blocking decision guard(s) failed.\x1b[0m");
    console.log("Each failure above names the decision, the premise it rests on, and what was rejected.");
    process.exit(1);
  }
  if (warnings > 0) {
    console.log("\n" + warnings + " warning-level guard(s) failed \u2014 advisory, build not blocked.");
  }
  process.exit(0);
}

main();
