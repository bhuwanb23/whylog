#!/usr/bin/env node
/*
 * Emitted by the WhyLog export compiler alongside CLAUDE.md / AGENTS.md / DECISIONS.md.
 *
 * Those documents contain `Verify:` lines of the form:
 *     node scripts/whylog-guards.cjs --decision WLD-0007
 * This file is what makes those lines true. It is compiled from the same graph in the same
 * pass, so a verify command cannot name a guard this runner does not have.
 *
 * Log head: 1a6228c7c0059d
 * Guards:   17
 *
 * Re-export after any change to the log. Editing this file by hand is detected as a stamp
 * mismatch, and the edit is lost on the next export.
 */
/**
 * WhyLog decision guards — generated. Do not edit by hand.
 *
 * Log head: 1a6228c7c0059d
 * Guards:   17
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
    id: "G-00010",
    decisionId: "WLD-0001",
    statement: "Use sqlite, not pos or postgres",
    kind: "dependency_present",
    target: "sqlite",
    severity: "warning",
    rationale:
      "WLD-0001 settled SCOPE on sqlite, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    spec: {
      kind: "dependency_present",
      package: "sqlite",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0004",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0005",
        text: "What's the actual concurrency requirement here",
        label: "IN",
      },
      {
        id: "P-0006",
        text: "it's one person, one machine, one log",
        label: "IN",
      },
      {
        id: "P-0007",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0008",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0009",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0010",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0011",
        text: "Migration path stays open because the schema is small",
        label: "IN",
      },
      {
        id: "P-0012",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0013",
        text: "What does auth protect, given the data lives in a local SQLite file on",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "post",
        whyRejected: "so no async ceremony everywhere, zero deploy",
      },
      {
        value: "postgres",
        whyRejected: "so no async ceremony everywhere, zero deploy",
      },
    ],
    appliesTo: ["here?"],
  },
  {
    id: "G-00011",
    decisionId: "WLD-0001",
    statement: "Use sqlite, not pos or postgres",
    kind: "dependency_absent",
    target: "post",
    severity: "blocking",
    rationale:
      'WLD-0001 rejected post — "so no async ceremony everywhere, zero deploy". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.',
    spec: {
      kind: "dependency_absent",
      package: "post",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0004",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0005",
        text: "What's the actual concurrency requirement here",
        label: "IN",
      },
      {
        id: "P-0006",
        text: "it's one person, one machine, one log",
        label: "IN",
      },
      {
        id: "P-0007",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0008",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0009",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0010",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0011",
        text: "Migration path stays open because the schema is small",
        label: "IN",
      },
      {
        id: "P-0012",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0013",
        text: "What does auth protect, given the data lives in a local SQLite file on",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "post",
        whyRejected: "so no async ceremony everywhere, zero deploy",
      },
      {
        value: "postgres",
        whyRejected: "so no async ceremony everywhere, zero deploy",
      },
    ],
    appliesTo: ["here?"],
  },
  {
    id: "G-00012",
    decisionId: "WLD-0001",
    statement: "Use sqlite, not pos or postgres",
    kind: "dependency_absent",
    target: "postgres",
    severity: "blocking",
    rationale:
      'WLD-0001 rejected postgres — "so no async ceremony everywhere, zero deploy". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.',
    spec: {
      kind: "dependency_absent",
      package: "postgres",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0004",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0005",
        text: "What's the actual concurrency requirement here",
        label: "IN",
      },
      {
        id: "P-0006",
        text: "it's one person, one machine, one log",
        label: "IN",
      },
      {
        id: "P-0007",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0008",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0009",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0010",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0011",
        text: "Migration path stays open because the schema is small",
        label: "IN",
      },
      {
        id: "P-0012",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0013",
        text: "What does auth protect, given the data lives in a local SQLite file on",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "post",
        whyRejected: "so no async ceremony everywhere, zero deploy",
      },
      {
        value: "postgres",
        whyRejected: "so no async ceremony everywhere, zero deploy",
      },
    ],
    appliesTo: ["here?"],
  },
  {
    id: "G-00020",
    decisionId: "WLD-0002",
    statement: "Use auth, not login",
    kind: "dependency_present",
    target: "auth",
    severity: "warning",
    rationale:
      "WLD-0002 settled AUTH on auth, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    spec: {
      kind: "dependency_present",
      package: "auth",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0005",
        text: "What's the actual concurrency requirement here",
        label: "IN",
      },
      {
        id: "P-0006",
        text: "it's one person, one machine, one log",
        label: "IN",
      },
      {
        id: "P-0007",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0008",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0009",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0011",
        text: "Migration path stays open because the schema is small",
        label: "IN",
      },
      {
        id: "P-0012",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0013",
        text: "What does auth protect, given the data lives in a local SQLite file on",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "login",
        whyRejected: null,
      },
    ],
    appliesTo: ["machine?"],
  },
  {
    id: "G-00021",
    decisionId: "WLD-0002",
    statement: "Use auth, not login",
    kind: "dependency_absent",
    target: "login",
    severity: "blocking",
    rationale:
      "WLD-0002 rejected login. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    spec: {
      kind: "dependency_absent",
      package: "login",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0005",
        text: "What's the actual concurrency requirement here",
        label: "IN",
      },
      {
        id: "P-0006",
        text: "it's one person, one machine, one log",
        label: "IN",
      },
      {
        id: "P-0007",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0008",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0009",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0011",
        text: "Migration path stays open because the schema is small",
        label: "IN",
      },
      {
        id: "P-0012",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0013",
        text: "What does auth protect, given the data lives in a local SQLite file on",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "login",
        whyRejected: null,
      },
    ],
    appliesTo: ["machine?"],
  },
  {
    id: "G-00022",
    decisionId: "WLD-0002",
    statement: "Use auth, not login",
    kind: "path_glob_exists",
    target: "machine?",
    severity: "warning",
    rationale:
      "WLD-0002 declares that it governs `machine?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to AUTH.",
    spec: {
      kind: "path_glob_exists",
      glob: "machine?",
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0005",
        text: "What's the actual concurrency requirement here",
        label: "IN",
      },
      {
        id: "P-0006",
        text: "it's one person, one machine, one log",
        label: "IN",
      },
      {
        id: "P-0007",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0008",
        text: "single file, synchronous API so no async ceremony everywhere, zero deploy",
        label: "IN",
      },
      {
        id: "P-0009",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0011",
        text: "Migration path stays open because the schema is small",
        label: "IN",
      },
      {
        id: "P-0012",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0013",
        text: "What does auth protect, given the data lives in a local SQLite file on",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "login",
        whyRejected: null,
      },
    ],
    appliesTo: ["machine?"],
  },
  {
    id: "G-00030",
    decisionId: "WLD-0003",
    statement: "Use single",
    kind: "dependency_present",
    target: "single",
    severity: "warning",
    rationale:
      "WLD-0003 settled ARCHITECTURE on single, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    spec: {
      kind: "dependency_present",
      package: "single",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0017",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0018",
        text: "it's a single page, three views, everything runs client side",
        label: "IN",
      },
      {
        id: "P-0019",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0020",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0021",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0022",
        text: "I'll note that as a deliberate decision so we don't",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "local",
        whyRejected: null,
      },
    ],
    appliesTo: ["presence?"],
  },
  {
    id: "G-00031",
    decisionId: "WLD-0003",
    statement: "Use single",
    kind: "dependency_absent",
    target: "local",
    severity: "blocking",
    rationale:
      "WLD-0003 rejected local. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    spec: {
      kind: "dependency_absent",
      package: "local",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0017",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0018",
        text: "it's a single page, three views, everything runs client side",
        label: "IN",
      },
      {
        id: "P-0019",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0020",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0021",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0022",
        text: "I'll note that as a deliberate decision so we don't",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "local",
        whyRejected: null,
      },
    ],
    appliesTo: ["presence?"],
  },
  {
    id: "G-00032",
    decisionId: "WLD-0003",
    statement: "Use single",
    kind: "path_glob_exists",
    target: "presence?",
    severity: "warning",
    rationale:
      "WLD-0003 declares that it governs `presence?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to ARCHITECTURE.",
    spec: {
      kind: "path_glob_exists",
      glob: "presence?",
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0017",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0018",
        text: "it's a single page, three views, everything runs client side",
        label: "IN",
      },
      {
        id: "P-0019",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0020",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0021",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0022",
        text: "I'll note that as a deliberate decision so we don't",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "local",
        whyRejected: null,
      },
    ],
    appliesTo: ["presence?"],
  },
  {
    id: "G-00040",
    decisionId: "WLD-0004",
    statement: "Use tailwind, not next. how or next",
    kind: "dependency_present",
    target: "tailwind",
    severity: "warning",
    rationale:
      "WLD-0004 settled FRAMEWORK on tailwind, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    spec: {
      kind: "dependency_present",
      package: "tailwind",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0017",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0018",
        text: "it's a single page, three views, everything runs client side",
        label: "IN",
      },
      {
        id: "P-0019",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0020",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0021",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0022",
        text: "I'll note that as a deliberate decision so we don't",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "next. how",
        whyRejected: null,
      },
      {
        value: "next",
        whyRejected: "hosted version",
      },
      {
        value: "next.js",
        whyRejected: null,
      },
    ],
    appliesTo: ["works?"],
  },
  {
    id: "G-00041",
    decisionId: "WLD-0004",
    statement: "Use tailwind, not next. how or next",
    kind: "dependency_absent",
    target: "next",
    severity: "blocking",
    rationale:
      'WLD-0004 rejected next — "hosted version". Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.',
    spec: {
      kind: "dependency_absent",
      package: "next",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0017",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0018",
        text: "it's a single page, three views, everything runs client side",
        label: "IN",
      },
      {
        id: "P-0019",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0020",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0021",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0022",
        text: "I'll note that as a deliberate decision so we don't",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "next. how",
        whyRejected: null,
      },
      {
        value: "next",
        whyRejected: "hosted version",
      },
      {
        value: "next.js",
        whyRejected: null,
      },
    ],
    appliesTo: ["works?"],
  },
  {
    id: "G-00042",
    decisionId: "WLD-0004",
    statement: "Use tailwind, not next. how or next",
    kind: "dependency_absent",
    target: "next.js",
    severity: "blocking",
    rationale:
      "WLD-0004 rejected next.js. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    spec: {
      kind: "dependency_absent",
      package: "next.js",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0017",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0018",
        text: "it's a single page, three views, everything runs client side",
        label: "IN",
      },
      {
        id: "P-0019",
        text: "there's no server",
        label: "IN",
      },
      {
        id: "P-0020",
        text: "we'll revisit, but not for the hackathon",
        label: "IN",
      },
      {
        id: "P-0021",
        text: "if it ever gets a hosted version",
        label: "IN",
      },
      {
        id: "P-0022",
        text: "I'll note that as a deliberate decision so we don't",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "next. how",
        whyRejected: null,
      },
      {
        value: "next",
        whyRejected: "hosted version",
      },
      {
        value: "next.js",
        whyRejected: null,
      },
    ],
    appliesTo: ["works?"],
  },
  {
    id: "G-00050",
    decisionId: "WLD-0005",
    statement: "Use embeddings, not 200 vectors or 200",
    kind: "dependency_present",
    target: "embeddings",
    severity: "warning",
    rationale:
      "WLD-0005 settled RETRIEVAL on embeddings, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    spec: {
      kind: "dependency_present",
      package: "embeddings",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0025",
        text: "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        label: "IN",
      },
      {
        id: "P-0027",
        text: "reasoning: dozens of decisions, sub-ms scan, no infra",
        label: "IN",
      },
      {
        id: "P-0029",
        text: "how many decisions are we talking about realistically",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "200",
        whyRejected: null,
      },
    ],
    appliesTo: ["realistically?", "extractor?"],
  },
  {
    id: "G-00051",
    decisionId: "WLD-0005",
    statement: "Use embeddings, not 200 vectors or 200",
    kind: "dependency_absent",
    target: "200",
    severity: "blocking",
    rationale:
      "WLD-0005 rejected 200. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    spec: {
      kind: "dependency_absent",
      package: "200",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0025",
        text: "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        label: "IN",
      },
      {
        id: "P-0027",
        text: "reasoning: dozens of decisions, sub-ms scan, no infra",
        label: "IN",
      },
      {
        id: "P-0029",
        text: "how many decisions are we talking about realistically",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "200",
        whyRejected: null,
      },
    ],
    appliesTo: ["realistically?", "extractor?"],
  },
  {
    id: "G-00052",
    decisionId: "WLD-0005",
    statement: "Use embeddings, not 200 vectors or 200",
    kind: "path_glob_exists",
    target: "realistically?",
    severity: "warning",
    rationale:
      "WLD-0005 declares that it governs `realistically?`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to RETRIEVAL.",
    spec: {
      kind: "path_glob_exists",
      glob: "realistically?",
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0025",
        text: "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        label: "IN",
      },
      {
        id: "P-0027",
        text: "reasoning: dozens of decisions, sub-ms scan, no infra",
        label: "IN",
      },
      {
        id: "P-0029",
        text: "how many decisions are we talking about realistically",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "200",
        whyRejected: null,
      },
    ],
    appliesTo: ["realistically?", "extractor?"],
  },
  {
    id: "G-00060",
    decisionId: "WLD-0006",
    statement: "Use golden-file, not ui test",
    kind: "dependency_present",
    target: "golden-file",
    severity: "warning",
    rationale:
      "WLD-0006 settled TESTING on golden-file, which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
    spec: {
      kind: "dependency_present",
      package: "golden-file",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0024",
        text: "I don't have time",
        label: "IN",
      },
      {
        id: "P-0025",
        text: "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        label: "IN",
      },
      {
        id: "P-0026",
        text: "the UI is throwaway for the demo",
        label: "IN",
      },
      {
        id: "P-0027",
        text: "reasoning: dozens of decisions, sub-ms scan, no infra",
        label: "IN",
      },
      {
        id: "P-0028",
        text: "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        label: "IN",
      },
      {
        id: "P-0029",
        text: "how many decisions are we talking about realistically",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "ui",
        whyRejected: null,
      },
    ],
    appliesTo: [],
  },
  {
    id: "G-00061",
    decisionId: "WLD-0006",
    statement: "Use golden-file, not ui test",
    kind: "dependency_absent",
    target: "ui",
    severity: "blocking",
    rationale:
      "WLD-0006 rejected ui. Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
    spec: {
      kind: "dependency_absent",
      package: "ui",
      includeDev: true,
    },
    decidedAt: "2026-10-03",
    restsOn: [
      {
        id: "P-0024",
        text: "I don't have time",
        label: "IN",
      },
      {
        id: "P-0025",
        text: "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        label: "IN",
      },
      {
        id: "P-0026",
        text: "the UI is throwaway for the demo",
        label: "IN",
      },
      {
        id: "P-0027",
        text: "reasoning: dozens of decisions, sub-ms scan, no infra",
        label: "IN",
      },
      {
        id: "P-0028",
        text: "Quick-log → \"Actually let's switch to Postgres, we need concurrent writes",
        label: "IN",
      },
      {
        id: "P-0029",
        text: "how many decisions are we talking about realistically",
        label: "IN",
      },
    ],
    rejected: [
      {
        value: "ui",
        whyRejected: null,
      },
    ],
    appliesTo: [],
  },
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

function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full);
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
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
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
      const includeDev =
        spec.includeDev === undefined ? spec.kind === "dependency_absent" : spec.includeDev;

      const inRuntime = project.dependencies[spec.package];
      const inDev = includeDev ? project.devDependencies[spec.package] : undefined;
      const version = inRuntime !== undefined ? inRuntime : inDev;
      const where = inRuntime !== undefined ? "dependencies" : "devDependencies";

      if (spec.kind === "dependency_present") {
        return version === undefined
          ? {
              outcome: "fail",
              evidence:
                '"' +
                spec.package +
                '" is not in package.json' +
                (includeDev
                  ? " (checked dependencies and devDependencies)"
                  : " (checked dependencies only)"),
            }
          : {
              outcome: "pass",
              evidence: '"' + spec.package + '": "' + version + '" is present in ' + where,
            };
      }
      return version !== undefined
        ? {
            outcome: "fail",
            evidence: '"' + spec.package + '": "' + version + '" found in package.json ' + where,
          }
        : { outcome: "pass", evidence: '"' + spec.package + '" does not appear in package.json' };
    }

    case "path_glob_exists":
    case "path_glob_absent": {
      const matches = project.files.filter((f) => matchesGlob(f, spec.glob));
      if (spec.kind === "path_glob_exists") {
        return matches.length === 0
          ? {
              outcome: "fail",
              evidence:
                "No file matches `" + spec.glob + "` among " + project.files.length + " path(s)",
            }
          : {
              outcome: "pass",
              evidence:
                matches.length +
                " file(s) match `" +
                spec.glob +
                "`: " +
                matches.slice(0, 6).join(", "),
            };
      }
      return matches.length > 0
        ? {
            outcome: "fail",
            evidence:
              matches.length +
              " file(s) match `" +
              spec.glob +
              "` but none should: " +
              matches.slice(0, 6).join(", "),
          }
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
        const quoted = JSON.stringify(
          hit.text.length > 160 ? hit.text.slice(0, 157) + "..." : hit.text,
        );
        if (spec.kind === "string_absent_in_files") {
          return {
            outcome: "fail",
            evidence: '"' + spec.pattern + '" found at ' + where + " — " + quoted,
          };
        }
        return {
          outcome: "pass",
          evidence: '"' + spec.pattern + '" found at ' + where + " — " + quoted,
        };
      }

      if (spec.kind === "string_in_files") {
        return {
          outcome: "fail",
          evidence:
            '"' +
            spec.pattern +
            '" does not appear in ' +
            scoped.length +
            " file(s) matching `" +
            spec.glob +
            "`",
        };
      }
      return {
        outcome: "pass",
        evidence:
          '"' +
          spec.pattern +
          '" does not appear in ' +
          scoped.length +
          " file(s) matching `" +
          spec.glob +
          "`",
      };
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
        return {
          outcome: "fail",
          evidence: "`" + spec.command + "` exited non-zero" + (out ? ": " + out : ""),
        };
      }
    }

    default:
      return {
        outcome: "skip",
        evidence: "kind " + spec.kind + " cannot run in CI without a model",
      };
  }
}

/* ----------------------------------------------------------------- report -- */
/* The failure message is the product. It does the job of an ADR, a code-review */
/* comment and an onboarding document, at the moment it is useful.             */

function reportFailure(guard, result) {
  const lines = [];
  lines.push("");
  lines.push("\x1b[31m\u2717 " + guard.decisionId + " \u2014 " + guard.statement + "\x1b[0m");
  lines.push(
    "  Guard " +
      guard.id +
      " (" +
      guard.kind +
      ": " +
      guard.target +
      ") FAILED  [" +
      guard.severity +
      "]",
  );
  lines.push("  Evidence: " + result.evidence);
  lines.push("  Why this check verifies that decision: " + guard.rationale);

  const premises =
    guard.restsOn.length === 0
      ? "nothing recorded"
      : guard.restsOn.map((p) => p.id + " " + p.text + " (" + p.label + ")").join(", ");
  lines.push("  Decided: " + guard.decidedAt + " \u00b7 Rests on: " + premises);

  if (guard.restsOn.length === 0) {
    lines.push(
      "    (no recorded premise, so nothing can falsify it \u2014 a gap worth filling in WhyLog)",
    );
  }

  for (const alt of guard.rejected) {
    lines.push(
      "  Rejected alternative " +
        alt.value +
        (alt.whyRejected
          ? ' \u2014 reason: "' + alt.whyRejected + '"'
          : " \u2014 no reason recorded"),
    );
  }

  lines.push("");
  lines.push(
    "  \u2192 Is this a deliberate reversal?   Record it in WhyLog so the log stops claiming otherwise.",
  );
  lines.push("  \u2192 Or is this drift?                Undo the change: " + undoHint(guard));
  return lines.join("\n");
}

function undoHint(guard) {
  switch (guard.kind) {
    case "dependency_absent":
      return 'remove the "' + guard.target + '" dependency.';
    case "dependency_present":
      return 'install "' + guard.target + '", or record the decision that replaced it.';
    case "path_glob_absent":
      return 'remove the file(s) matching "' + guard.target + '".';
    case "path_glob_exists":
      return 'restore the file(s) matching "' + guard.target + '".';
    case "string_absent_in_files":
      return 'remove "' + guard.target + '" from the files in scope.';
    case "string_in_files":
      return 'add "' + guard.target + '" where the decision expects it.';
    default:
      return "see the guard's rationale above.";
  }
}

/* -------------------------------------------------------------------- main -- */

function main() {
  const manifest = readManifest();
  const files = listFiles(".");
  const project = {
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
    files: files,
  };

  console.info(
    "WhyLog decision guards \u00b7 " +
      GUARDS.length +
      " guard(s) \u00b7 " +
      files.length +
      " file(s) scanned",
  );

  let blocking = 0;
  let warnings = 0;
  let passed = 0;
  let skipped = 0;

  for (const guard of GUARDS) {
    const result = evaluate(guard, project);

    if (result.outcome === "pass") {
      passed += 1;
      continue;
    }
    if (result.outcome === "skip") {
      skipped += 1;
      console.info(
        "\x1b[33m\u2013 " +
          guard.id +
          " SKIPPED\x1b[0m (" +
          guard.kind +
          ": " +
          guard.target +
          ") \u2014 " +
          result.evidence,
      );
      continue;
    }

    if (guard.severity === "blocking") blocking += 1;
    else warnings += 1;

    console.info(reportFailure(guard, result));
  }

  console.info("");
  console.info(
    "  passed " +
      passed +
      " \u00b7 failed " +
      (blocking + warnings) +
      " (" +
      blocking +
      " blocking, " +
      warnings +
      " warning) \u00b7 skipped " +
      skipped,
  );

  if (blocking > 0) {
    console.error("\n\x1b[31m" + blocking + " blocking decision guard(s) failed.\x1b[0m");
    console.error(
      "Each failure above names the decision, the premise it rests on, and what was rejected.",
    );
    process.exit(1);
  }
  if (warnings > 0) {
    console.info(
      "\n" + warnings + " warning-level guard(s) failed \u2014 advisory, build not blocked.",
    );
  }
  process.exit(0);
}

main();
