#!/usr/bin/env node
/**
 * WhyLog decision guards — generated. Do not edit by hand.
 *
 * Log head: 31d6baea6adb30
 * Guards:   56
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
    "id": "G-0001a",
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
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0003",
        "text": "a stated requirement is dropped or changed — excluded by \"I need somewhere to put decisions,\"",
        "label": "IN"
      },
      {
        "id": "P-0002",
        "text": "It contains 6 extractable decisions, one of which (Postgres, Oct 3) is the trap",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "Supabase?"
    ]
  },
  {
    "id": "G-0001b",
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
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0003",
        "text": "a stated requirement is dropped or changed — excluded by \"I need somewhere to put decisions,\"",
        "label": "IN"
      },
      {
        "id": "P-0002",
        "text": "It contains 6 extractable decisions, one of which (Postgres, Oct 3) is the trap",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "Supabase?"
    ]
  },
  {
    "id": "G-0001c",
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
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0003",
        "text": "a stated requirement is dropped or changed — excluded by \"I need somewhere to put decisions,\"",
        "label": "IN"
      },
      {
        "id": "P-0002",
        "text": "It contains 6 extractable decisions, one of which (Postgres, Oct 3) is the trap",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "Supabase?"
    ]
  },
  {
    "id": "G-0002a",
    "decisionId": "WLD-0002",
    "statement": "Use sqlite, not postgres. single-user",
    "kind": "dependency_present",
    "target": "better-sqlite3",
    "severity": "blocking",
    "rationale": "WLD-0002 chose sqlite, so a sqlite driver must be in the dependency tree. `better-sqlite3` is the usual one; sql.js, libsql, @libsql/client, sqlite3 would also satisfy the decision, and if you use one of those, edit this guard rather than suppressing it.",
    "spec": {
      "kind": "dependency_present",
      "package": "better-sqlite3",
      "includeDev": false
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
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
      }
    ],
    "rejected": [
      {
        "value": "single-user",
        "whyRejected": null
      },
      {
        "value": "postgres",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "here?",
      "auth?"
    ]
  },
  {
    "id": "G-0002b",
    "decisionId": "WLD-0002",
    "statement": "Use sqlite, not postgres. single-user",
    "kind": "dependency_present",
    "target": "sqlite",
    "severity": "warning",
    "rationale": "WLD-0002 settled DATABASE on sqlite, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "sqlite",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
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
      }
    ],
    "rejected": [
      {
        "value": "single-user",
        "whyRejected": null
      },
      {
        "value": "postgres",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "here?",
      "auth?"
    ]
  },
  {
    "id": "G-0002c",
    "decisionId": "WLD-0002",
    "statement": "Use sqlite, not postgres. single-user",
    "kind": "dependency_absent",
    "target": "pg",
    "severity": "blocking",
    "rationale": "WLD-0002 rejected postgres — \"so no async ceremony everywhere, zero deploy\". No pg driver should appear while this decision is IN. devDependencies are in scope: a rejected database installed as a dev dependency is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "pg",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "IN"
      },
      {
        "id": "P-0008",
        "text": "single file, synchronous API so no async ceremony everywhere, zero deploy",
        "label": "IN"
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
      }
    ],
    "rejected": [
      {
        "value": "single-user",
        "whyRejected": null
      },
      {
        "value": "postgres",
        "whyRejected": "so no async ceremony everywhere, zero deploy"
      }
    ],
    "appliesTo": [
      "here?",
      "auth?"
    ]
  },
  {
    "id": "G-0003a",
    "decisionId": "WLD-0003",
    "statement": "Use single-user, not postgres for or postgres",
    "kind": "dependency_present",
    "target": "single-user",
    "severity": "warning",
    "rationale": "WLD-0003 settled SCOPE on single-user, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "single-user",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0016",
        "text": "a stated requirement is dropped or changed — excluded by \"What's the actual concurrency requirement here\"",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "IN"
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
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0021",
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
    "id": "G-0003b",
    "decisionId": "WLD-0003",
    "statement": "Use single-user, not postgres for or postgres",
    "kind": "dependency_absent",
    "target": "postgres",
    "severity": "blocking",
    "rationale": "WLD-0003 rejected postgres — \"because the schema is small\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "postgres",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0016",
        "text": "a stated requirement is dropped or changed — excluded by \"What's the actual concurrency requirement here\"",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "IN"
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
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0021",
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
    "id": "G-0003c",
    "decisionId": "WLD-0003",
    "statement": "Use single-user, not postgres for or postgres",
    "kind": "path_glob_exists",
    "target": "auth?",
    "severity": "warning",
    "rationale": "WLD-0003 declares that it governs `auth?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to SCOPE.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "auth?"
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0017",
        "text": "we'll revisit, but not for the hackathon",
        "label": "IN"
      },
      {
        "id": "P-0016",
        "text": "a stated requirement is dropped or changed — excluded by \"What's the actual concurrency requirement here\"",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "IN"
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
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0021",
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
    "id": "G-0004a",
    "decisionId": "WLD-0004",
    "statement": "Use local, not login",
    "kind": "dependency_present",
    "target": "local",
    "severity": "warning",
    "rationale": "WLD-0004 settled AUTH on local, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "local",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [],
    "rejected": [],
    "appliesTo": [
      "machine?"
    ]
  },
  {
    "id": "G-0004b",
    "decisionId": "WLD-0004",
    "statement": "Use local, not login",
    "kind": "path_glob_exists",
    "target": "machine?",
    "severity": "warning",
    "rationale": "WLD-0004 declares that it governs `machine?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to AUTH.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "machine?"
    },
    "decidedAt": "2026-10-03",
    "restsOn": [],
    "rejected": [],
    "appliesTo": [
      "machine?"
    ]
  },
  {
    "id": "G-0005a",
    "decisionId": "WLD-0005",
    "statement": "Use local, not login",
    "kind": "dependency_present",
    "target": "local",
    "severity": "warning",
    "rationale": "WLD-0005 settled AUTH on local, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "local",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0016",
        "text": "a stated requirement is dropped or changed — excluded by \"What's the actual concurrency requirement here\"",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "IN"
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
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
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
        "value": "login",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "presence?"
    ]
  },
  {
    "id": "G-0005b",
    "decisionId": "WLD-0005",
    "statement": "Use local, not login",
    "kind": "dependency_absent",
    "target": "login",
    "severity": "blocking",
    "rationale": "WLD-0005 rejected login. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "login",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0016",
        "text": "a stated requirement is dropped or changed — excluded by \"What's the actual concurrency requirement here\"",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "IN"
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
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
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
        "value": "login",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "presence?"
    ]
  },
  {
    "id": "G-0005c",
    "decisionId": "WLD-0005",
    "statement": "Use local, not login",
    "kind": "path_glob_exists",
    "target": "presence?",
    "severity": "warning",
    "rationale": "WLD-0005 declares that it governs `presence?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to AUTH.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "presence?"
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0016",
        "text": "a stated requirement is dropped or changed — excluded by \"What's the actual concurrency requirement here\"",
        "label": "IN"
      },
      {
        "id": "P-0006",
        "text": "it's one person, one machine, one log",
        "label": "IN"
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
        "id": "P-0019",
        "text": "there's no server",
        "label": "IN"
      },
      {
        "id": "P-0011",
        "text": "Migration path stays open because the schema is small",
        "label": "IN"
      },
      {
        "id": "P-0021",
        "text": "if it ever gets a hosted version",
        "label": "IN"
      },
      {
        "id": "P-0013",
        "text": "What does auth protect, given the data lives in a local SQLite file on",
        "label": "IN"
      },
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
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
        "value": "login",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "presence?"
    ]
  },
  {
    "id": "G-0006a",
    "decisionId": "WLD-0006",
    "statement": "Use single-page, not server-side sur",
    "kind": "dependency_present",
    "target": "single-page",
    "severity": "warning",
    "rationale": "WLD-0006 settled FRAMEWORK on single-page, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "single-page",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
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
    "id": "G-0006b",
    "decisionId": "WLD-0006",
    "statement": "Use single-page, not server-side sur",
    "kind": "dependency_absent",
    "target": "server-side",
    "severity": "blocking",
    "rationale": "WLD-0006 rejected server-side — \"so search works\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "server-side",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
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
    "id": "G-0006c",
    "decisionId": "WLD-0006",
    "statement": "Use single-page, not server-side sur",
    "kind": "dependency_absent",
    "target": "next",
    "severity": "blocking",
    "rationale": "WLD-0006 rejected next — \"so search works\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "next",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
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
    "id": "G-0007a",
    "decisionId": "WLD-0007",
    "statement": "Use tailwind, not next. how or next",
    "kind": "dependency_present",
    "target": "tailwind",
    "severity": "warning",
    "rationale": "WLD-0007 settled UI_KIT on tailwind, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "tailwind",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
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
    "id": "G-0007b",
    "decisionId": "WLD-0007",
    "statement": "Use tailwind, not next. how or next",
    "kind": "dependency_absent",
    "target": "next",
    "severity": "blocking",
    "rationale": "WLD-0007 rejected next — \"hosted version\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "next",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
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
    "id": "G-0007c",
    "decisionId": "WLD-0007",
    "statement": "Use tailwind, not next. how or next",
    "kind": "dependency_absent",
    "target": "next.js",
    "severity": "blocking",
    "rationale": "WLD-0007 rejected next.js. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "next.js",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0018",
        "text": "it's a single page, three views, everything runs client side",
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
    "id": "G-0008a",
    "decisionId": "WLD-0008",
    "statement": "Use embeddings, not 200 vectors or 200",
    "kind": "dependency_present",
    "target": "embeddings",
    "severity": "warning",
    "rationale": "WLD-0008 settled RETRIEVAL on embeddings, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "embeddings",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
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
      },
      {
        "value": "sub-millisecond",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "realistically?",
      "extractor?"
    ]
  },
  {
    "id": "G-0008b",
    "decisionId": "WLD-0008",
    "statement": "Use embeddings, not 200 vectors or 200",
    "kind": "dependency_absent",
    "target": "200",
    "severity": "blocking",
    "rationale": "WLD-0008 rejected 200. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "200",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
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
      },
      {
        "value": "sub-millisecond",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "realistically?",
      "extractor?"
    ]
  },
  {
    "id": "G-0008c",
    "decisionId": "WLD-0008",
    "statement": "Use embeddings, not 200 vectors or 200",
    "kind": "dependency_absent",
    "target": "sub-millisecond",
    "severity": "blocking",
    "rationale": "WLD-0008 rejected sub-millisecond. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "sub-millisecond",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
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
      },
      {
        "value": "sub-millisecond",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "realistically?",
      "extractor?"
    ]
  },
  {
    "id": "G-0009a",
    "decisionId": "WLD-0009",
    "statement": "Use text-in, not doing full",
    "kind": "dependency_present",
    "target": "text-in",
    "severity": "warning",
    "rationale": "WLD-0009 settled OTHER on text-in, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "text-in",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
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
    "id": "G-0009b",
    "decisionId": "WLD-0009",
    "statement": "Use text-in, not doing full",
    "kind": "dependency_absent",
    "target": "doing",
    "severity": "blocking",
    "rationale": "WLD-0009 rejected doing — \"I write unit tests for the extractor\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "doing",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
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
    "id": "G-0009c",
    "decisionId": "WLD-0009",
    "statement": "Use text-in, not doing full",
    "kind": "dependency_absent",
    "target": "testing",
    "severity": "blocking",
    "rationale": "WLD-0009 rejected testing. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "testing",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
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
    "id": "G-0010a",
    "decisionId": "WLD-0010",
    "statement": "Use golden-file, not ui test",
    "kind": "dependency_present",
    "target": "golden-file",
    "severity": "warning",
    "rationale": "WLD-0010 settled TESTING on golden-file, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "golden-file",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0024",
        "text": "I don't have time",
        "label": "IN"
      },
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0026",
        "text": "the UI is throwaway for the demo",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
        "label": "IN"
      },
      {
        "id": "P-0032",
        "text": "a stated requirement is dropped or changed — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
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
    "id": "G-0010b",
    "decisionId": "WLD-0010",
    "statement": "Use golden-file, not ui test",
    "kind": "dependency_absent",
    "target": "ui",
    "severity": "blocking",
    "rationale": "WLD-0010 rejected ui. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "ui",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0024",
        "text": "I don't have time",
        "label": "IN"
      },
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0026",
        "text": "the UI is throwaway for the demo",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
        "label": "IN"
      },
      {
        "id": "P-0032",
        "text": "a stated requirement is dropped or changed — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
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
    "id": "G-0011a",
    "decisionId": "WLD-0011",
    "statement": "Use postgres",
    "kind": "dependency_present",
    "target": "pg",
    "severity": "blocking",
    "rationale": "WLD-0011 chose postgres, so a postgres driver must be in the dependency tree. `pg` is the usual one; postgres, postgresql, @neondatabase/serverless, drizzle-orm would also satisfy the decision, and if you use one of those, edit this guard rather than suppressing it.",
    "spec": {
      "kind": "dependency_present",
      "package": "pg",
      "includeDev": false
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
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
        "value": "single-user",
        "whyRejected": null
      },
      {
        "value": "next.js",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "auth?"
    ]
  },
  {
    "id": "G-0011b",
    "decisionId": "WLD-0011",
    "statement": "Use postgres",
    "kind": "dependency_present",
    "target": "postgres",
    "severity": "warning",
    "rationale": "WLD-0011 settled DATABASE on postgres, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "postgres",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
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
        "value": "single-user",
        "whyRejected": null
      },
      {
        "value": "next.js",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "auth?"
    ]
  },
  {
    "id": "G-0011c",
    "decisionId": "WLD-0011",
    "statement": "Use postgres",
    "kind": "dependency_absent",
    "target": "single-user",
    "severity": "blocking",
    "rationale": "WLD-0011 rejected single-user. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "single-user",
      "includeDev": true
    },
    "decidedAt": "2026-10-03",
    "restsOn": [
      {
        "id": "P-0030",
        "text": "more than one process needs to write at once — excluded by \"Quick-log → \"Actually let's switch to Postgres, we need concurrent writes\"",
        "label": "IN"
      },
      {
        "id": "P-0031",
        "text": "infrastructure becomes available or required — excluded by \"reasoning: dozens of decisions, sub-ms scan, no infra\"",
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
        "value": "single-user",
        "whyRejected": null
      },
      {
        "value": "next.js",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "auth?"
    ]
  },
  {
    "id": "G-0012a",
    "decisionId": "WLD-0012",
    "statement": "Use now, not one person",
    "kind": "dependency_present",
    "target": "now",
    "severity": "warning",
    "rationale": "WLD-0012 settled OTHER on now, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "now",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0033",
        "text": "it's not one person any more",
        "label": "IN"
      },
      {
        "id": "P-0040",
        "text": "more than one process needs to write at once — excluded by \"concurrent_writers — more than one process writing at once\"",
        "label": "IN"
      },
      {
        "id": "P-0035",
        "text": "sqlite can't arbitrate them and there's no server to do it",
        "label": "IN"
      },
      {
        "id": "P-0038",
        "text": "there are four of us on it now, and two of us edit decisions at the same time",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "person",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "different?"
    ]
  },
  {
    "id": "G-0012b",
    "decisionId": "WLD-0012",
    "statement": "Use now, not one person",
    "kind": "dependency_absent",
    "target": "person",
    "severity": "blocking",
    "rationale": "WLD-0012 rejected person. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "person",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0033",
        "text": "it's not one person any more",
        "label": "IN"
      },
      {
        "id": "P-0040",
        "text": "more than one process needs to write at once — excluded by \"concurrent_writers — more than one process writing at once\"",
        "label": "IN"
      },
      {
        "id": "P-0035",
        "text": "sqlite can't arbitrate them and there's no server to do it",
        "label": "IN"
      },
      {
        "id": "P-0038",
        "text": "there are four of us on it now, and two of us edit decisions at the same time",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "person",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "different?"
    ]
  },
  {
    "id": "G-0012c",
    "decisionId": "WLD-0012",
    "statement": "Use now, not one person",
    "kind": "path_glob_exists",
    "target": "different?",
    "severity": "warning",
    "rationale": "WLD-0012 declares that it governs `different?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to OTHER.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "different?"
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0033",
        "text": "it's not one person any more",
        "label": "IN"
      },
      {
        "id": "P-0040",
        "text": "more than one process needs to write at once — excluded by \"concurrent_writers — more than one process writing at once\"",
        "label": "IN"
      },
      {
        "id": "P-0035",
        "text": "sqlite can't arbitrate them and there's no server to do it",
        "label": "IN"
      },
      {
        "id": "P-0038",
        "text": "there are four of us on it now, and two of us edit decisions at the same time",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "person",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "different?"
    ]
  },
  {
    "id": "G-0013a",
    "decisionId": "WLD-0013",
    "statement": "Use postgres, not so",
    "kind": "dependency_present",
    "target": "pg",
    "severity": "blocking",
    "rationale": "WLD-0013 chose postgres, so a postgres driver must be in the dependency tree. `pg` is the usual one; postgres, postgresql, @neondatabase/serverless, drizzle-orm would also satisfy the decision, and if you use one of those, edit this guard rather than suppressing it.",
    "spec": {
      "kind": "dependency_present",
      "package": "pg",
      "includeDev": false
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0033",
        "text": "it's not one person any more",
        "label": "IN"
      },
      {
        "id": "P-0040",
        "text": "more than one process needs to write at once — excluded by \"concurrent_writers — more than one process writing at once\"",
        "label": "IN"
      },
      {
        "id": "P-0035",
        "text": "sqlite can't arbitrate them and there's no server to do it",
        "label": "IN"
      },
      {
        "id": "P-0042",
        "text": "a stated requirement is dropped or changed — excluded by \"With four people and concurrent edits, the premise is false, so the decision has to be revisited rather than defended\"",
        "label": "IN"
      },
      {
        "id": "P-0038",
        "text": "there are four of us on it now, and two of us edit decisions at the same time",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "son",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "now?"
    ]
  },
  {
    "id": "G-0013b",
    "decisionId": "WLD-0013",
    "statement": "Use postgres, not so",
    "kind": "dependency_present",
    "target": "postgres",
    "severity": "warning",
    "rationale": "WLD-0013 settled DATABASE on postgres, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "postgres",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0033",
        "text": "it's not one person any more",
        "label": "IN"
      },
      {
        "id": "P-0040",
        "text": "more than one process needs to write at once — excluded by \"concurrent_writers — more than one process writing at once\"",
        "label": "IN"
      },
      {
        "id": "P-0035",
        "text": "sqlite can't arbitrate them and there's no server to do it",
        "label": "IN"
      },
      {
        "id": "P-0042",
        "text": "a stated requirement is dropped or changed — excluded by \"With four people and concurrent edits, the premise is false, so the decision has to be revisited rather than defended\"",
        "label": "IN"
      },
      {
        "id": "P-0038",
        "text": "there are four of us on it now, and two of us edit decisions at the same time",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "son",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "now?"
    ]
  },
  {
    "id": "G-0013c",
    "decisionId": "WLD-0013",
    "statement": "Use postgres, not so",
    "kind": "dependency_absent",
    "target": "son",
    "severity": "blocking",
    "rationale": "WLD-0013 rejected son. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "son",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0033",
        "text": "it's not one person any more",
        "label": "IN"
      },
      {
        "id": "P-0040",
        "text": "more than one process needs to write at once — excluded by \"concurrent_writers — more than one process writing at once\"",
        "label": "IN"
      },
      {
        "id": "P-0035",
        "text": "sqlite can't arbitrate them and there's no server to do it",
        "label": "IN"
      },
      {
        "id": "P-0042",
        "text": "a stated requirement is dropped or changed — excluded by \"With four people and concurrent edits, the premise is false, so the decision has to be revisited rather than defended\"",
        "label": "IN"
      },
      {
        "id": "P-0038",
        "text": "there are four of us on it now, and two of us edit decisions at the same time",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "son",
        "whyRejected": null
      }
    ],
    "appliesTo": [
      "now?"
    ]
  },
  {
    "id": "G-0014a",
    "decisionId": "WLD-0014",
    "statement": "Use clerk, not rolling yo or rolling",
    "kind": "dependency_present",
    "target": "@clerk/clerk-react",
    "severity": "blocking",
    "rationale": "WLD-0014 chose clerk for auth, so `@clerk/clerk-react` should be present. Only the first matching package needs to be there; if you use a different binding for the same vendor, edit this guard.",
    "spec": {
      "kind": "dependency_present",
      "package": "@clerk/clerk-react",
      "includeDev": false
    },
    "decidedAt": "2026-11-18",
    "restsOn": [],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "now?",
      "Postgres?"
    ]
  },
  {
    "id": "G-0014b",
    "decisionId": "WLD-0014",
    "statement": "Use clerk, not rolling yo or rolling",
    "kind": "dependency_present",
    "target": "clerk",
    "severity": "warning",
    "rationale": "WLD-0014 settled AUTH on clerk, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "clerk",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "now?",
      "Postgres?"
    ]
  },
  {
    "id": "G-0014c",
    "decisionId": "WLD-0014",
    "statement": "Use clerk, not rolling yo or rolling",
    "kind": "dependency_absent",
    "target": "next-auth",
    "severity": "warning",
    "rationale": "`next-auth` is a competing auth approach and WLD-0014 settled on clerk. Two auth systems in one tree means sessions, tokens and user records can diverge.",
    "spec": {
      "kind": "dependency_absent",
      "package": "next-auth",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [],
    "rejected": [],
    "appliesTo": [
      "auth?",
      "now?",
      "Postgres?"
    ]
  },
  {
    "id": "G-0015a",
    "decisionId": "WLD-0015",
    "statement": "Use supabase",
    "kind": "dependency_present",
    "target": "@supabase/supabase-js",
    "severity": "blocking",
    "rationale": "WLD-0015 chose supabase, so a supabase driver must be in the dependency tree.",
    "spec": {
      "kind": "dependency_present",
      "package": "@supabase/supabase-js",
      "includeDev": false
    },
    "decidedAt": "2026-11-18",
    "restsOn": [],
    "rejected": [],
    "appliesTo": [
      "now?",
      "Postgres?"
    ]
  },
  {
    "id": "G-0015b",
    "decisionId": "WLD-0015",
    "statement": "Use supabase",
    "kind": "dependency_present",
    "target": "supabase",
    "severity": "warning",
    "rationale": "WLD-0015 settled DATABASE on supabase, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "supabase",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [],
    "rejected": [],
    "appliesTo": [
      "now?",
      "Postgres?"
    ]
  },
  {
    "id": "G-0015c",
    "decisionId": "WLD-0015",
    "statement": "Use supabase",
    "kind": "dependency_absent",
    "target": "better-sqlite3",
    "severity": "blocking",
    "rationale": "`better-sqlite3` is mutually exclusive with supabase under DATABASE, which WLD-0015 settled. Its presence would mean the decision has been reversed in code without being reversed in the log.",
    "spec": {
      "kind": "dependency_absent",
      "package": "better-sqlite3",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [],
    "rejected": [],
    "appliesTo": [
      "now?",
      "Postgres?"
    ]
  },
  {
    "id": "G-0016a",
    "decisionId": "WLD-0016",
    "statement": "Use clerk, not rolling yo or rolling",
    "kind": "dependency_present",
    "target": "@clerk/clerk-react",
    "severity": "blocking",
    "rationale": "WLD-0016 chose clerk for auth, so `@clerk/clerk-react` should be present. Only the first matching package needs to be there; if you use a different binding for the same vendor, edit this guard.",
    "spec": {
      "kind": "dependency_present",
      "package": "@clerk/clerk-react",
      "includeDev": false
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0052",
        "text": "a stated requirement is dropped or changed — excluded by \"we need auth\"",
        "label": "IN"
      },
      {
        "id": "P-0044",
        "text": "It matters independently, because a hosted Postgres needs a network connection the local tool never had to make",
        "label": "IN"
      },
      {
        "id": "P-0051",
        "text": "Why Clerk rather than rolling your own or using Supabase auth, given you are already on Postgres",
        "label": "IN"
      },
      {
        "id": "P-0046",
        "text": "Do you need to know WHO made a decision now",
        "label": "IN"
      },
      {
        "id": "P-0048",
        "text": "Understood — so the constraint is time, not capability",
        "label": "IN"
      },
      {
        "id": "P-0050",
        "text": "building login is two weeks I don't have, and supabase auth would mean moving the database too",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "rolling",
        "whyRejected": "because building login is two weeks I don't have, and supabase auth would mean moving the database too"
      },
      {
        "value": "rolling",
        "whyRejected": "because building login is two weeks I don't have, and supabase auth would mean moving the database too"
      },
      {
        "value": "local",
        "whyRejected": "se: deployment"
      }
    ],
    "appliesTo": [
      "Postgres?"
    ]
  },
  {
    "id": "G-0016b",
    "decisionId": "WLD-0016",
    "statement": "Use clerk, not rolling yo or rolling",
    "kind": "dependency_present",
    "target": "clerk",
    "severity": "warning",
    "rationale": "WLD-0016 settled AUTH on clerk, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "clerk",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0052",
        "text": "a stated requirement is dropped or changed — excluded by \"we need auth\"",
        "label": "IN"
      },
      {
        "id": "P-0044",
        "text": "It matters independently, because a hosted Postgres needs a network connection the local tool never had to make",
        "label": "IN"
      },
      {
        "id": "P-0051",
        "text": "Why Clerk rather than rolling your own or using Supabase auth, given you are already on Postgres",
        "label": "IN"
      },
      {
        "id": "P-0046",
        "text": "Do you need to know WHO made a decision now",
        "label": "IN"
      },
      {
        "id": "P-0048",
        "text": "Understood — so the constraint is time, not capability",
        "label": "IN"
      },
      {
        "id": "P-0050",
        "text": "building login is two weeks I don't have, and supabase auth would mean moving the database too",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "rolling",
        "whyRejected": "because building login is two weeks I don't have, and supabase auth would mean moving the database too"
      },
      {
        "value": "rolling",
        "whyRejected": "because building login is two weeks I don't have, and supabase auth would mean moving the database too"
      },
      {
        "value": "local",
        "whyRejected": "se: deployment"
      }
    ],
    "appliesTo": [
      "Postgres?"
    ]
  },
  {
    "id": "G-0016c",
    "decisionId": "WLD-0016",
    "statement": "Use clerk, not rolling yo or rolling",
    "kind": "dependency_absent",
    "target": "rolling",
    "severity": "blocking",
    "rationale": "WLD-0016 rejected rolling — \"because building login is two weeks I don't have, and supabase auth would mean moving the database too\". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    "spec": {
      "kind": "dependency_absent",
      "package": "rolling",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0052",
        "text": "a stated requirement is dropped or changed — excluded by \"we need auth\"",
        "label": "IN"
      },
      {
        "id": "P-0044",
        "text": "It matters independently, because a hosted Postgres needs a network connection the local tool never had to make",
        "label": "IN"
      },
      {
        "id": "P-0051",
        "text": "Why Clerk rather than rolling your own or using Supabase auth, given you are already on Postgres",
        "label": "IN"
      },
      {
        "id": "P-0046",
        "text": "Do you need to know WHO made a decision now",
        "label": "IN"
      },
      {
        "id": "P-0048",
        "text": "Understood — so the constraint is time, not capability",
        "label": "IN"
      },
      {
        "id": "P-0050",
        "text": "building login is two weeks I don't have, and supabase auth would mean moving the database too",
        "label": "IN"
      }
    ],
    "rejected": [
      {
        "value": "rolling",
        "whyRejected": "because building login is two weeks I don't have, and supabase auth would mean moving the database too"
      },
      {
        "value": "rolling",
        "whyRejected": "because building login is two weeks I don't have, and supabase auth would mean moving the database too"
      },
      {
        "value": "local",
        "whyRejected": "se: deployment"
      }
    ],
    "appliesTo": [
      "Postgres?"
    ]
  },
  {
    "id": "G-0017a",
    "decisionId": "WLD-0017",
    "statement": "Use supabase",
    "kind": "dependency_present",
    "target": "@supabase/supabase-js",
    "severity": "blocking",
    "rationale": "WLD-0017 chose supabase, so a supabase driver must be in the dependency tree.",
    "spec": {
      "kind": "dependency_present",
      "package": "@supabase/supabase-js",
      "includeDev": false
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0052",
        "text": "a stated requirement is dropped or changed — excluded by \"we need auth\"",
        "label": "IN"
      },
      {
        "id": "P-0051",
        "text": "Why Clerk rather than rolling your own or using Supabase auth, given you are already on Postgres",
        "label": "IN"
      },
      {
        "id": "P-0046",
        "text": "Do you need to know WHO made a decision now",
        "label": "IN"
      },
      {
        "id": "P-0050",
        "text": "building login is two weeks I don't have, and supabase auth would mean moving the database too",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "Postgres?"
    ]
  },
  {
    "id": "G-0017b",
    "decisionId": "WLD-0017",
    "statement": "Use supabase",
    "kind": "dependency_present",
    "target": "supabase",
    "severity": "warning",
    "rationale": "WLD-0017 settled DATABASE on supabase, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "supabase",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0052",
        "text": "a stated requirement is dropped or changed — excluded by \"we need auth\"",
        "label": "IN"
      },
      {
        "id": "P-0051",
        "text": "Why Clerk rather than rolling your own or using Supabase auth, given you are already on Postgres",
        "label": "IN"
      },
      {
        "id": "P-0046",
        "text": "Do you need to know WHO made a decision now",
        "label": "IN"
      },
      {
        "id": "P-0050",
        "text": "building login is two weeks I don't have, and supabase auth would mean moving the database too",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "Postgres?"
    ]
  },
  {
    "id": "G-0017c",
    "decisionId": "WLD-0017",
    "statement": "Use supabase",
    "kind": "dependency_absent",
    "target": "better-sqlite3",
    "severity": "blocking",
    "rationale": "`better-sqlite3` is mutually exclusive with supabase under DATABASE, which WLD-0017 settled. Its presence would mean the decision has been reversed in code without being reversed in the log.",
    "spec": {
      "kind": "dependency_absent",
      "package": "better-sqlite3",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0052",
        "text": "a stated requirement is dropped or changed — excluded by \"we need auth\"",
        "label": "IN"
      },
      {
        "id": "P-0051",
        "text": "Why Clerk rather than rolling your own or using Supabase auth, given you are already on Postgres",
        "label": "IN"
      },
      {
        "id": "P-0046",
        "text": "Do you need to know WHO made a decision now",
        "label": "IN"
      },
      {
        "id": "P-0050",
        "text": "building login is two weeks I don't have, and supabase auth would mean moving the database too",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "Postgres?"
    ]
  },
  {
    "id": "G-0018a",
    "decisionId": "WLD-0018",
    "statement": "Use claude.md",
    "kind": "dependency_present",
    "target": "claude.md",
    "severity": "warning",
    "rationale": "WLD-0018 settled OTHER on claude.md, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "claude.md",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0053",
        "text": "Then the decision is about the SOURCE OF TRUTH rather than about a format: the log is authoritative and every export target is generated",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "now?",
      "it?"
    ]
  },
  {
    "id": "G-0018b",
    "decisionId": "WLD-0018",
    "statement": "Use claude.md",
    "kind": "path_glob_exists",
    "target": "now?",
    "severity": "warning",
    "rationale": "WLD-0018 declares that it governs `now?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to OTHER.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "now?"
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0053",
        "text": "Then the decision is about the SOURCE OF TRUTH rather than about a format: the log is authoritative and every export target is generated",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "now?",
      "it?"
    ]
  },
  {
    "id": "G-0018c",
    "decisionId": "WLD-0018",
    "statement": "Use claude.md",
    "kind": "path_glob_exists",
    "target": "it?",
    "severity": "warning",
    "rationale": "WLD-0018 declares that it governs `it?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to OTHER.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "it?"
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0053",
        "text": "Then the decision is about the SOURCE OF TRUTH rather than about a format: the log is authoritative and every export target is generated",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "now?",
      "it?"
    ]
  },
  {
    "id": "G-0019a",
    "decisionId": "WLD-0019",
    "statement": "Use agent-native",
    "kind": "dependency_present",
    "target": "agent-native",
    "severity": "warning",
    "rationale": "WLD-0019 settled OTHER on agent-native, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "agent-native",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0053",
        "text": "Then the decision is about the SOURCE OF TRUTH rather than about a format: the log is authoritative and every export target is generated",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "now?",
      "it?"
    ]
  },
  {
    "id": "G-0019b",
    "decisionId": "WLD-0019",
    "statement": "Use agent-native",
    "kind": "path_glob_exists",
    "target": "now?",
    "severity": "warning",
    "rationale": "WLD-0019 declares that it governs `now?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to OTHER.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "now?"
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0053",
        "text": "Then the decision is about the SOURCE OF TRUTH rather than about a format: the log is authoritative and every export target is generated",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "now?",
      "it?"
    ]
  },
  {
    "id": "G-0019c",
    "decisionId": "WLD-0019",
    "statement": "Use agent-native",
    "kind": "path_glob_exists",
    "target": "it?",
    "severity": "warning",
    "rationale": "WLD-0019 declares that it governs `it?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to OTHER.",
    "spec": {
      "kind": "path_glob_exists",
      "glob": "it?"
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0053",
        "text": "Then the decision is about the SOURCE OF TRUTH rather than about a format: the log is authoritative and every export target is generated",
        "label": "IN"
      }
    ],
    "rejected": [],
    "appliesTo": [
      "now?",
      "it?"
    ]
  },
  {
    "id": "G-0020a",
    "decisionId": "WLD-0020",
    "statement": "Use now",
    "kind": "dependency_present",
    "target": "now",
    "severity": "warning",
    "rationale": "WLD-0020 settled OTHER on now, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    "spec": {
      "kind": "dependency_present",
      "package": "now",
      "includeDev": true
    },
    "decidedAt": "2026-11-18",
    "restsOn": [
      {
        "id": "P-0055",
        "text": "that is the case a decision log cannot catch on its own, because every original decision was correct when it was written",
        "label": "IN"
      },
      {
        "id": "P-0057",
        "text": "we have users now, so a silent regression in the extractor becomes a wrong decision in somebody's AGENTS",
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

/* `--decision WLD-0007` restricts the run to one decision's guards. The verify command exported */
/* into CLAUDE.md / AGENTS.md / DECISIONS.md uses exactly this flag, so an agent can check one    */
/* rule without running the whole set. It is supported HERE rather than by a second runner: two   */
/* runners would drift, and a verify command naming a flag the runner ignores would exit 0 for a  */
/* decision that is broken.                                                                       */
function parseArgs(argv) {
  const opts = { decision: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--decision" && argv[i + 1] !== undefined) { opts.decision = argv[i + 1]; i += 1; }
    else if (typeof argv[i] === "string" && argv[i].startsWith("--decision=")) { opts.decision = argv[i].slice(11); }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = readManifest();
  const files = listFiles(".");
  const project = { dependencies: manifest.dependencies, devDependencies: manifest.devDependencies, files: files };

  const selected = opts.decision === null ? GUARDS : GUARDS.filter((g) => g.decisionId === opts.decision);

  if (opts.decision !== null && selected.length === 0) {
    /* Exiting 0 here would tell an agent the decision is fine when the truth is that this runner
     * holds no guards for it — most likely because the export predates the decision. Exit 2 says
     * "I could not check this", which is a different claim from "it passed". */
    console.error("[31mNo guards in this runner for decision " + opts.decision + ".[0m");
    console.error("The exported runner is probably older than that decision. Re-export from WhyLog.");
    process.exit(2);
  }

  console.log("WhyLog decision guards \u00b7 " + selected.length + " of " + GUARDS.length + " guard(s)" + (opts.decision === null ? "" : " for " + opts.decision) + " \u00b7 " + files.length + " file(s) scanned");

  let blocking = 0;
  let warnings = 0;
  let passed = 0;
  let skipped = 0;

  for (const guard of selected) {
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
