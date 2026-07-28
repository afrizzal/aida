// ---------------------------------------------------------------------------
// AIDA demo dataset — FICTIONAL CONTENT ONLY.
//
// Every contact/company here is invented for this demo workspace ("Huddlebase",
// a fictional team-collaboration SaaS). All email addresses use the reserved
// `.example` TLD (RFC 2606) — never a routable domain. Nothing in this file is
// a real customer, a real company, or a real metric. See seed-demo-data.ts for
// how this pure data is written to the database (07-02, AIDA-22).
// ---------------------------------------------------------------------------

export interface DemoContact {
  name: string;
  email: string; // MUST use a reserved .example TLD — never a routable domain
  company: string;
  phone?: string;
}

export interface DemoReply {
  author: "contact" | "admin" | "agent";
  visibility: "PUBLIC" | "INTERNAL";
  body: string; // markdown
  offsetHours: number; // hours AFTER the ticket's createdAt
}

export interface DemoTicket {
  subject: string;
  body: string; // initial inbound message, markdown
  contactEmail: string; // must match a DEMO_CONTACTS entry
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
  ageHours: number; // how long ago the ticket was created
  assignee: "admin" | "agent" | null;
  tags: string[]; // must be a subset of DEMO_TAGS
  customFields?: { label: string; value: string | number | boolean }[];
  firstResponseAfterHours: number | null; // null = no agent response yet
  resolvedAfterHours: number | null; // null = unresolved
  slaState: "on-track" | "at-risk" | "breached";
  triage: {
    category: "BILLING" | "TECHNICAL" | "ACCOUNT" | "FEATURE_REQUEST" | "OTHER";
    sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
    language: string; // ISO 639-1
    status: "COMPLETED" | "FAILED";
  } | null; // null = never triaged (AI was off)
  csat?: { score: 1 | 2 | 3 | 4 | 5; comment?: string };
  replies: DemoReply[];
}

export interface DemoCustomField {
  label: string;
  type: "TEXT" | "SELECT" | "NUMBER" | "CHECKBOX" | "DATE";
  options?: string[];
  position: number;
}

export interface DemoKbArticle {
  title: string;
  bodyMarkdown: string;
}

// ---------------------------------------------------------------------------
// Contacts — 12 across 7 fictional companies (Northwind Cafe, Baxter Logistics
// and Marrow Analytics/Cobalt Robotics/Driftwood Media each have 2+ contacts,
// so per-company volume drivers have real variety).
// ---------------------------------------------------------------------------
export const DEMO_CONTACTS: DemoContact[] = [
  {
    name: "Maya Chen",
    email: "maya.chen@northwind-cafe.example",
    company: "Northwind Cafe",
    phone: "+1-555-0101",
  },
  {
    name: "Owen Castillo",
    email: "owen.castillo@northwind-cafe.example",
    company: "Northwind Cafe",
  },
  {
    name: "Priya Natarajan",
    email: "priya.natarajan@baxter-logistics.example",
    company: "Baxter Logistics",
    phone: "+1-555-0114",
  },
  {
    name: "Derek Voss",
    email: "derek.voss@baxter-logistics.example",
    company: "Baxter Logistics",
  },
  {
    name: "Lena Brandt",
    email: "lena.brandt@solstice-studio.example",
    company: "Solstice Studio",
  },
  {
    name: "Tomas Reyes",
    email: "tomas.reyes@marrow-analytics.example",
    company: "Marrow Analytics",
    phone: "+1-555-0142",
  },
  {
    name: "Ingrid Solberg",
    email: "ingrid.solberg@marrow-analytics.example",
    company: "Marrow Analytics",
  },
  {
    name: "Winston Park",
    email: "winston.park@fernwood-realty.example",
    company: "Fernwood Realty",
  },
  {
    name: "Camille Dupuis",
    email: "camille.dupuis@cobalt-robotics.example",
    company: "Cobalt Robotics",
    phone: "+1-555-0167",
  },
  {
    name: "Rasheed Ali",
    email: "rasheed.ali@cobalt-robotics.example",
    company: "Cobalt Robotics",
  },
  {
    name: "Sofia Marquez",
    email: "sofia.marquez@driftwood-media.example",
    company: "Driftwood Media",
  },
  {
    name: "Elias Kroll",
    email: "elias.kroll@driftwood-media.example",
    company: "Driftwood Media",
  },
];

export const DEMO_TAGS: string[] = [
  "billing",
  "bug",
  "onboarding",
  "integration",
  "feature-request",
  "password-reset",
  "data-export",
  "escalated",
];

export const DEMO_CUSTOM_FIELDS: DemoCustomField[] = [
  { label: "Plan", type: "SELECT", options: ["Free", "Pro", "Enterprise"], position: 0 },
  { label: "Account ID", type: "TEXT", position: 1 },
  { label: "Escalated to engineering", type: "CHECKBOX", position: 2 },
];

// ---------------------------------------------------------------------------
// Tickets — exactly 30, hand-tuned to the exact distributions required by
// 07-02-PLAN.md's content contract (status/priority/SLA/assignee/triage/csat/
// age/reply counts are all acceptance criteria, not just flavor).
// ---------------------------------------------------------------------------
export const DEMO_TICKETS: DemoTicket[] = [
  // --- NEW (4): T1-T4 — zero replies, so firstResponseAfterHours is null on all four. ---
  {
    subject: "Can't find the CSV export button anymore",
    body: "Hi team, I used to be able to export our ticket list to CSV from the inbox view, but I can't find that button anymore. Did it move somewhere? We run a weekly report off this export for our ops team.",
    contactEmail: "maya.chen@northwind-cafe.example",
    priority: "NORMAL",
    status: "NEW",
    ageHours: 2,
    assignee: null,
    tags: ["data-export"],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: null,
    replies: [],
  },
  {
    subject: "Slack messages not syncing into Huddlebase threads",
    body: "We connected the Slack integration two weeks ago and it worked fine at first, but for the last three days new Slack messages in our #support channel aren't showing up as ticket replies anymore. Nothing changed on our end that we know of.",
    contactEmail: "owen.castillo@northwind-cafe.example",
    priority: "HIGH",
    status: "NEW",
    ageHours: 5,
    assignee: null,
    tags: ["integration", "bug"],
    customFields: [{ label: "Escalated to engineering", value: false }],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: null,
    replies: [],
  },
  {
    subject: "Charged twice for our Enterprise renewal – invoice #INV-20488",
    body: "Our card was charged twice for the annual Enterprise renewal — invoice #INV-20488 shows two identical $4,800 charges on the same day. Can someone confirm this is a duplicate and refund one of them? This is holding up our finance team's month-end close.",
    contactEmail: "priya.natarajan@baxter-logistics.example",
    priority: "URGENT",
    status: "NEW",
    ageHours: 12,
    assignee: "admin",
    tags: ["billing", "escalated"],
    customFields: [
      { label: "Plan", value: "Enterprise" },
      { label: "Account ID", value: "ACC-10432" },
    ],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "breached",
    triage: { category: "BILLING", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    replies: [],
  },
  {
    subject: "Webhook deliveries to our warehouse system failing since Tuesday",
    body: "Since Tuesday morning, none of our webhook deliveries to our internal warehouse system are going through. We're seeing repeated failures in our own logs but no error detail on your side that we can see. This is blocking inventory sync for our whole ops team.",
    contactEmail: "derek.voss@baxter-logistics.example",
    priority: "HIGH",
    status: "NEW",
    ageHours: 20,
    assignee: "admin",
    tags: ["integration", "bug"],
    customFields: [
      { label: "Account ID", value: "ACC-58820" },
      { label: "Escalated to engineering", value: true },
    ],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "at-risk",
    triage: { category: "TECHNICAL", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    replies: [],
  },

  // --- OPEN (9): T5-T13 ---
  {
    subject: "How do I add a custom field for project budget?",
    body: "We track project budgets internally and I'd like to add a custom field for it on tickets, similar to how the Plan field works. Is that something we can set up ourselves from Settings, or does it require your team?",
    contactEmail: "lena.brandt@solstice-studio.example",
    priority: "NORMAL",
    status: "OPEN",
    ageHours: 30,
    assignee: null,
    tags: [],
    customFields: [{ label: "Plan", value: "Free" }],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: { category: "OTHER", sentiment: "NEUTRAL", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Just checking in on this — happy to hop on a call if that's easier.",
        offsetHours: 20,
      },
    ],
  },
  {
    subject: "Suggestion: dark mode for the mobile app",
    body: "Loving the product so far! One thing that would make it even better for our late-night on-call rotation: a dark mode for the mobile app. Right now the bright white screen is rough at 2am.",
    contactEmail: "tomas.reyes@marrow-analytics.example",
    priority: "LOW",
    status: "OPEN",
    ageHours: 48,
    assignee: null,
    tags: ["feature-request"],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: null,
    replies: [
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Also would love this on the iPad app, not just phone.",
        offsetHours: 30,
      },
    ],
  },
  {
    subject: "Question about seat count on our Pro plan",
    body: "We're on the Pro plan with what I believe is 18 seats currently. Before we invite 5 more teammates next week, can you confirm our current seat count and whether Pro has a hard seat limit?",
    contactEmail: "ingrid.solberg@marrow-analytics.example",
    priority: "NORMAL",
    status: "OPEN",
    ageHours: 72,
    assignee: null,
    tags: ["billing"],
    customFields: [{ label: "Plan", value: "Pro" }],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: null,
    replies: [
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "We're at 18 seats currently, want to confirm before adding 5 more.",
        offsetHours: 40,
      },
    ],
  },
  {
    subject: "Two-factor authentication codes never arrive",
    body: "Two of us can't log in because the two-factor authentication codes never arrive by email or SMS. We've tried resending several times over the last two days. Can you check if there's an issue on your end?",
    contactEmail: "winston.park@fernwood-realty.example",
    priority: "NORMAL",
    status: "OPEN",
    ageHours: 100,
    assignee: null,
    tags: ["bug"],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: { category: "ACCOUNT", sentiment: "NEGATIVE", language: "en", status: "FAILED" },
    replies: [
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Still nothing. Tried resending the code 3 times now.",
        offsetHours: 20,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "This is really blocking my whole team from logging in.",
        offsetHours: 60,
      },
    ],
  },
  {
    subject: "Production data export API returning 500 errors all morning",
    body: "Our nightly data export job that hits the export API has been returning 500 errors since around 6am this morning. This feeds our internal BI dashboard and finance reporting, so this is fairly urgent for us.",
    contactEmail: "camille.dupuis@cobalt-robotics.example",
    priority: "URGENT",
    status: "OPEN",
    ageHours: 150,
    assignee: "admin",
    tags: ["bug", "data-export", "escalated"],
    customFields: [
      { label: "Plan", value: "Enterprise" },
      { label: "Account ID", value: "ACC-77210" },
      { label: "Escalated to engineering", value: true },
    ],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "breached",
    triage: { category: "TECHNICAL", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "admin",
        visibility: "INTERNAL",
        body: "Paging infra — this looks like our export worker is stuck, checking logs now.",
        offsetHours: 5,
      },
    ],
  },
  {
    subject: "Need bulk user import for 40 new hires",
    body: "We have 40 new hires starting in two weeks and would love a way to bulk-import users instead of adding them one by one. Is there a CSV import for team members, or is that on the roadmap?",
    contactEmail: "rasheed.ali@cobalt-robotics.example",
    priority: "HIGH",
    status: "OPEN",
    ageHours: 200,
    assignee: null,
    tags: ["feature-request", "onboarding"],
    customFields: [{ label: "Plan", value: "Pro" }],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: {
      category: "FEATURE_REQUEST",
      sentiment: "NEUTRAL",
      language: "en",
      status: "COMPLETED",
    },
    replies: [
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Bumping this — we have new hires starting Monday.",
        offsetHours: 50,
      },
    ],
  },
  {
    subject: "Cannot reset password – reset email never arrives",
    body: "I requested a password reset three times over the past day and the reset email never arrives, not even in spam. Two other people on my team have hit the same issue this week.",
    contactEmail: "sofia.marquez@driftwood-media.example",
    priority: "HIGH",
    status: "OPEN",
    ageHours: 250,
    assignee: "admin",
    tags: ["password-reset", "bug"],
    customFields: [{ label: "Account ID", value: "ACC-64410" }],
    firstResponseAfterHours: 10,
    resolvedAfterHours: null,
    slaState: "at-risk",
    triage: { category: "ACCOUNT", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "admin",
        visibility: "INTERNAL",
        body: "Checked our email logs — nothing bounced, might be a spam-filter issue on their end. Following up.",
        offsetHours: 8,
      },
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "Just sent you a fresh reset link directly from our side — try this one and let us know if it comes through.",
        offsetHours: 10,
      },
    ],
  },
  {
    subject: "Duplicate contacts appearing after CSV import",
    body: "After importing our contact list via CSV yesterday, we're now seeing duplicate contact entries for about a third of the rows — same email address showing up twice with slightly different names. This is throwing off our contact counts.",
    contactEmail: "elias.kroll@driftwood-media.example",
    priority: "NORMAL",
    status: "OPEN",
    ageHours: 300,
    assignee: null,
    tags: ["bug", "data-export"],
    customFields: [{ label: "Escalated to engineering", value: false }],
    firstResponseAfterHours: null,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: { category: "TECHNICAL", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Attaching a screenshot — this happens on every import batch.",
        offsetHours: 60,
      },
    ],
  },
  {
    subject: "Feature request: recurring ticket templates for weekly reports",
    body: "It would be great to have recurring ticket templates — we send the same weekly status-report ticket to ourselves every Monday and it'd save time to have it auto-generate from a template instead of copy-pasting.",
    contactEmail: "maya.chen@northwind-cafe.example",
    priority: "LOW",
    status: "OPEN",
    ageHours: 400,
    assignee: "agent",
    tags: ["feature-request"],
    customFields: [{ label: "Plan", value: "Free" }],
    firstResponseAfterHours: 12,
    resolvedAfterHours: null,
    slaState: "at-risk",
    triage: {
      category: "FEATURE_REQUEST",
      sentiment: "POSITIVE",
      language: "en",
      status: "COMPLETED",
    },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "Thanks for the idea! Let me loop in product to see if we can prioritize this.",
        offsetHours: 12,
      },
      {
        author: "agent",
        visibility: "INTERNAL",
        body: "Added to the recurring-tickets backlog — low priority, revisit next planning cycle.",
        offsetHours: 12.5,
      },
    ],
  },

  // --- PENDING (5): T14-T18 — agent already replied, waiting on the customer. ---
  {
    subject: "Onboarding checklist – where do I invite my team?",
    body: "We just signed up and I'm going through the onboarding checklist. I don't see where to invite the rest of my team — is that under a specific settings page?",
    contactEmail: "owen.castillo@northwind-cafe.example",
    priority: "NORMAL",
    status: "PENDING",
    ageHours: 90,
    assignee: "admin",
    tags: ["onboarding"],
    customFields: [{ label: "Account ID", value: "ACC-20044" }],
    firstResponseAfterHours: 3,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: { category: "OTHER", sentiment: "NEUTRAL", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "Happy to help — you can invite teammates from Settings > Team > Invite Member.",
        offsetHours: 3,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Got it, thank you! One more question — is there a seat limit on the Free plan?",
        offsetHours: 10,
      },
    ],
  },
  {
    subject: "Invoice shows wrong seat count after downgrade to Pro",
    body: "We downgraded from Enterprise to Pro on the 3rd of this month, but our latest invoice still shows the old Enterprise seat count and price. Can someone take a look at invoice INV-20502?",
    contactEmail: "priya.natarajan@baxter-logistics.example",
    priority: "HIGH",
    status: "PENDING",
    ageHours: 130,
    assignee: "admin",
    tags: ["billing"],
    customFields: [
      { label: "Plan", value: "Pro" },
      { label: "Account ID", value: "ACC-33871" },
    ],
    firstResponseAfterHours: 4,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: { category: "BILLING", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "Looking into your account now — can you confirm the invoice number you're referencing?",
        offsetHours: 4,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "It's INV-20502, downgraded from Enterprise to Pro on the 3rd.",
        offsetHours: 15,
      },
    ],
  },
  {
    subject: "All webhook retries exhausted – integration completely down",
    body: "All of our webhook retries are now exhausted and the integration appears to be completely down — zero events have come through in the last 18 hours. This is a production-impacting issue for our warehouse system.",
    contactEmail: "derek.voss@baxter-logistics.example",
    priority: "URGENT",
    status: "PENDING",
    ageHours: 180,
    assignee: "agent",
    tags: ["integration", "bug", "escalated"],
    customFields: [
      { label: "Plan", value: "Enterprise" },
      { label: "Account ID", value: "ACC-90142" },
      { label: "Escalated to engineering", value: true },
    ],
    firstResponseAfterHours: 2,
    resolvedAfterHours: null,
    slaState: "breached",
    triage: { category: "TECHNICAL", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "We see the retries exhausting on our end — escalating to engineering immediately.",
        offsetHours: 2,
      },
      {
        author: "agent",
        visibility: "INTERNAL",
        body: "Escalated to on-call engineering, ticket #ENG-4471 opened. Customer is Enterprise tier — treat as P1.",
        offsetHours: 2.5,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Any update? We've had zero data flowing into our warehouse for a week now.",
        offsetHours: 40,
      },
    ],
  },
  {
    subject: "Losing formatting when pasting from Figma into ticket notes",
    body: "When I paste content copied from Figma into a ticket's internal notes, all the formatting (bold, bullet points) gets stripped out and it comes through as one big paragraph. Regular text pasted from other apps works fine.",
    contactEmail: "lena.brandt@solstice-studio.example",
    priority: "HIGH",
    status: "PENDING",
    ageHours: 260,
    assignee: "admin",
    tags: ["bug"],
    customFields: [{ label: "Escalated to engineering", value: false }],
    firstResponseAfterHours: 6,
    resolvedAfterHours: null,
    slaState: "at-risk",
    triage: { category: "TECHNICAL", sentiment: "NEUTRAL", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "Can you share a sample of the pasted content? Want to reproduce the formatting loss.",
        offsetHours: 6,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Sent a screen recording — attached to this thread.",
        offsetHours: 30,
      },
    ],
  },
  {
    subject: "¿Cómo cambio el idioma de mi cuenta?",
    body: "Hola, ¿podrían decirme cómo cambio el idioma de mi cuenta a español? Actualmente el idioma configurado es inglés.",
    contactEmail: "tomas.reyes@marrow-analytics.example",
    priority: "LOW",
    status: "PENDING",
    ageHours: 350,
    assignee: "agent",
    tags: [],
    firstResponseAfterHours: 5,
    resolvedAfterHours: null,
    slaState: "on-track",
    triage: { category: "ACCOUNT", sentiment: "NEUTRAL", language: "es", status: "COMPLETED" },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "You can change your account language from Settings > Profile > Language preference.",
        offsetHours: 5,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Perfect, found it. ¡Gracias!",
        offsetHours: 20,
      },
    ],
  },

  // --- RESOLVED (8): T19-T26 — always on-track (flags clear on resolve). ---
  {
    subject: "Password reset link expired before I could use it",
    body: "The password reset link you sent expired before I had a chance to click it — I only waited about 20 minutes. Can you send a new one with a longer expiry, or at least tell me the window?",
    contactEmail: "ingrid.solberg@marrow-analytics.example",
    priority: "NORMAL",
    status: "RESOLVED",
    ageHours: 500,
    assignee: "admin",
    tags: ["password-reset"],
    firstResponseAfterHours: 3,
    resolvedAfterHours: 7,
    slaState: "on-track",
    triage: { category: "ACCOUNT", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    csat: { score: 5, comment: "Took a bit long but got resolved, thanks!" },
    replies: [
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "Sorry about that! I've sent a fresh reset link — it should be valid for 24 hours this time.",
        offsetHours: 3,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Got it, reset successfully. Thanks for the quick help!",
        offsetHours: 6,
      },
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "Glad to hear it — marking this resolved. Reach out if anything else comes up.",
        offsetHours: 7,
      },
    ],
  },
  {
    subject: "How do I connect Huddlebase to our Slack workspace?",
    body: "Trying to connect our workspace's Slack account so ticket notifications show up in our #support-alerts channel. I found the Integrations tab but I'm not sure which permissions to grant during the OAuth prompt.",
    contactEmail: "winston.park@fernwood-realty.example",
    priority: "NORMAL",
    status: "RESOLVED",
    ageHours: 600,
    assignee: "agent",
    tags: ["integration"],
    firstResponseAfterHours: 4,
    resolvedAfterHours: 10,
    slaState: "on-track",
    triage: { category: "TECHNICAL", sentiment: "NEUTRAL", language: "en", status: "COMPLETED" },
    csat: { score: 5 },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "You can connect Slack from Settings > Integrations > Slack — the walk-through doc is linked there too.",
        offsetHours: 4,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "All connected now, thank you!",
        offsetHours: 10,
      },
    ],
  },
  {
    subject: "Requesting a refund for duplicate Enterprise invoice",
    body: "We were billed twice this cycle for our Enterprise plan — I can see two separate charges of the same amount three days apart on our card statement. Requesting a refund for the duplicate.",
    contactEmail: "camille.dupuis@cobalt-robotics.example",
    priority: "HIGH",
    status: "RESOLVED",
    ageHours: 700,
    assignee: "admin",
    tags: ["billing"],
    customFields: [
      { label: "Plan", value: "Enterprise" },
      { label: "Account ID", value: "ACC-10432" },
      { label: "Escalated to engineering", value: false },
    ],
    firstResponseAfterHours: 2,
    resolvedAfterHours: 30,
    slaState: "on-track",
    triage: { category: "BILLING", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    csat: { score: 4 },
    replies: [
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "Confirmed the duplicate charge on our end — processing your refund now.",
        offsetHours: 2,
      },
      {
        author: "admin",
        visibility: "INTERNAL",
        body: "Refund of $4,800 submitted via our payment processor, ref RF-88213. Following up once it clears.",
        offsetHours: 2.2,
      },
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "The refund has cleared and should appear on your statement within 3-5 business days.",
        offsetHours: 30,
      },
    ],
  },
  {
    subject: "CSV export is missing the 'Assigned To' column",
    body: "When I export tickets to CSV, the file is missing the 'Assigned To' column that used to be there a few months ago. We rely on that column for our weekly workload report.",
    contactEmail: "rasheed.ali@cobalt-robotics.example",
    priority: "NORMAL",
    status: "RESOLVED",
    ageHours: 800,
    assignee: "agent",
    tags: ["data-export", "bug"],
    firstResponseAfterHours: 5,
    resolvedAfterHours: 20,
    slaState: "on-track",
    triage: { category: "TECHNICAL", sentiment: "NEUTRAL", language: "en", status: "COMPLETED" },
    csat: { score: 5 },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "Good catch — the Assigned To column was missing from the CSV export. Shipped a fix, please re-export.",
        offsetHours: 5,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Confirmed, the column is there now. Thanks for the fast fix!",
        offsetHours: 20,
      },
    ],
  },
  {
    subject: "Great support last week – quick follow-up question on custom fields",
    body: "Just wanted to say the support last week on our billing question was fantastic — quick and clear. One more small thing: is there a limit on how many custom fields we can create per workspace?",
    contactEmail: "sofia.marquez@driftwood-media.example",
    priority: "LOW",
    status: "RESOLVED",
    ageHours: 900,
    assignee: "admin",
    tags: [],
    firstResponseAfterHours: 6,
    resolvedAfterHours: 24,
    slaState: "on-track",
    triage: { category: "OTHER", sentiment: "POSITIVE", language: "en", status: "COMPLETED" },
    csat: { score: 3, comment: "Really appreciated the quick, friendly help." },
    replies: [
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "Custom fields live under Settings > Custom Fields — happy to walk through it on a call if useful.",
        offsetHours: 6,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "That answered it, thank you!",
        offsetHours: 24,
      },
    ],
  },
  {
    subject: "Wie richte ich die Zwei-Faktor-Authentifizierung ein?",
    body: "Guten Tag, ich möchte gerne die Zwei-Faktor-Authentifizierung für mein Konto einrichten, finde aber die Option nicht in den Einstellungen. Können Sie mir bitte helfen?",
    contactEmail: "elias.kroll@driftwood-media.example",
    priority: "NORMAL",
    status: "RESOLVED",
    ageHours: 1000,
    assignee: "agent",
    tags: [],
    customFields: [{ label: "Escalated to engineering", value: false }],
    firstResponseAfterHours: 4,
    resolvedAfterHours: 15,
    slaState: "on-track",
    triage: { category: "ACCOUNT", sentiment: "NEUTRAL", language: "de", status: "COMPLETED" },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "You can enable 2FA under Settings > Security > Two-Factor Authentication.",
        offsetHours: 4,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Danke, funktioniert jetzt!",
        offsetHours: 15,
      },
    ],
  },
  {
    subject: "Great news – the dark mode rollout looks fantastic!",
    body: "Just noticed the new dark mode in the latest release — it looks fantastic and our whole team has already switched over. Really appreciate the fast turnaround on this one, we requested it just a few weeks ago!",
    contactEmail: "maya.chen@northwind-cafe.example",
    priority: "NORMAL",
    status: "RESOLVED",
    ageHours: 1100,
    assignee: "admin",
    tags: ["feature-request"],
    firstResponseAfterHours: 3,
    resolvedAfterHours: 5,
    slaState: "on-track",
    triage: {
      category: "FEATURE_REQUEST",
      sentiment: "POSITIVE",
      language: "en",
      status: "COMPLETED",
    },
    csat: { score: 4 },
    replies: [
      {
        author: "admin",
        visibility: "PUBLIC",
        body: "Thanks so much for the kind words — I'll pass this along to the team!",
        offsetHours: 3,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Will do, keep up the great work.",
        offsetHours: 5,
      },
    ],
  },
  {
    subject: "Billing cycle changed without notice – please explain",
    body: "Our billing cycle date seems to have changed from the 15th to the 1st of the month without any notice, and it's thrown off our internal budget tracking. Can you explain what changed and why?",
    contactEmail: "owen.castillo@northwind-cafe.example",
    priority: "HIGH",
    status: "RESOLVED",
    ageHours: 1250,
    assignee: "agent",
    tags: ["billing", "escalated"],
    firstResponseAfterHours: 3,
    resolvedAfterHours: 20,
    slaState: "on-track",
    triage: { category: "BILLING", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "You're right, we changed billing cycles for annual plans in March — I'm sorry this wasn't communicated clearly.",
        offsetHours: 3,
      },
      {
        author: "agent",
        visibility: "INTERNAL",
        body: "Flagging to billing team — comms gap on the March cycle-date migration, several customers affected.",
        offsetHours: 3.2,
      },
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "As a goodwill gesture we've credited one month to your account.",
        offsetHours: 20,
      },
    ],
  },

  // --- CLOSED (4): T27-T30 — always on-track. ---
  {
    subject: "Thanks for closing out the onboarding tickets",
    body: "Wanted to say thanks for all the help getting our whole team onboarded this month — every ticket we opened got a fast, clear answer. Really appreciate it.",
    contactEmail: "priya.natarajan@baxter-logistics.example",
    priority: "NORMAL",
    status: "CLOSED",
    ageHours: 1400,
    assignee: "agent",
    tags: ["onboarding"],
    firstResponseAfterHours: 3,
    resolvedAfterHours: 6,
    slaState: "on-track",
    triage: { category: "OTHER", sentiment: "POSITIVE", language: "en", status: "COMPLETED" },
    csat: { score: 5 },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "Glad we could help get your team fully onboarded!",
        offsetHours: 3,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Appreciate all the help this month.",
        offsetHours: 6,
      },
    ],
  },
  {
    subject: "Old ticket – webhook issue resolved on your end, closing loop",
    body: "Circling back on the webhook issue from a while back — we can confirm it's been resolved on our end for weeks now, sorry for the slow follow-up. Feel free to close this out.",
    contactEmail: "derek.voss@baxter-logistics.example",
    priority: "LOW",
    status: "CLOSED",
    ageHours: 1600,
    assignee: "agent",
    tags: ["integration"],
    firstResponseAfterHours: 5,
    resolvedAfterHours: 8,
    slaState: "on-track",
    triage: { category: "TECHNICAL", sentiment: "POSITIVE", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "Thanks for confirming — closing this out on our side too.",
        offsetHours: 5,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Sounds good, thanks!",
        offsetHours: 8,
      },
    ],
  },
  {
    subject: "Following up again on my data export request",
    body: "Following up again — I still haven't received the CSV export I requested last week for our customer list. Can someone confirm the status or resend it?",
    contactEmail: "lena.brandt@solstice-studio.example",
    priority: "NORMAL",
    status: "CLOSED",
    ageHours: 1800,
    assignee: "agent",
    tags: ["data-export"],
    firstResponseAfterHours: 30,
    resolvedAfterHours: 40,
    slaState: "on-track",
    triage: { category: "OTHER", sentiment: "NEGATIVE", language: "en", status: "COMPLETED" },
    csat: { score: 2, comment: "Resolved eventually, but the wait was frustrating." },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "Apologies for the delay — your export is attached below.",
        offsetHours: 30,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "Thanks, though this took much longer than expected.",
        offsetHours: 40,
      },
    ],
  },
  {
    subject: "Closing – password reset issue from last quarter",
    body: "Just confirming this password reset ticket from last quarter can be closed out — everything's been working fine since the reset went through.",
    contactEmail: "tomas.reyes@marrow-analytics.example",
    priority: "NORMAL",
    status: "CLOSED",
    ageHours: 2100,
    assignee: "agent",
    tags: ["password-reset"],
    firstResponseAfterHours: 4,
    resolvedAfterHours: 8,
    slaState: "on-track",
    triage: { category: "ACCOUNT", sentiment: "NEUTRAL", language: "en", status: "COMPLETED" },
    replies: [
      {
        author: "agent",
        visibility: "PUBLIC",
        body: "Confirmed your password has been reset successfully — let us know if you need anything else.",
        offsetHours: 4,
      },
      {
        author: "contact",
        visibility: "PUBLIC",
        body: "All good now, thanks.",
        offsetHours: 8,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// KB articles — exactly 6, topics overlap the ticket subjects above so the
// seeded KB-gap analysis (Task 3) is coherent.
// ---------------------------------------------------------------------------
export const DEMO_KB_ARTICLES: DemoKbArticle[] = [
  {
    title: "Resetting your password",
    bodyMarkdown: `## Resetting your password

If you've forgotten your password, you can reset it yourself in under a minute — no need to open a ticket unless the reset email doesn't arrive.

### Steps

1. On the sign-in page, click **Forgot password?**.
2. Enter the email address associated with your account.
3. Check your inbox for an email titled "Reset your Huddlebase password." It usually arrives within a minute.
4. Click the link in the email and choose a new password. The link is valid for **1 hour**.
5. Sign in with your new password.

### If the reset email doesn't arrive

- Check your spam or promotions folder — some corporate mail filters quarantine automated emails.
- Confirm you're using the exact email address your workspace admin used to invite you. If you have more than one email, you may have an account under a different address.
- Wait a few minutes and try again — email delivery can occasionally lag during high-traffic periods.
- If you still don't see it after 15 minutes, contact your workspace admin, who can verify the account's email on file and trigger a fresh reset from the Team settings page.

### If the link has expired

Reset links expire after 1 hour for security. If yours has expired:

\`\`\`text
Error: This password reset link has expired or already been used.
\`\`\`

Simply go back to the sign-in page and request a new one — each request invalidates the previous link, so only the most recent email will work.

### Two-factor authentication reminder

If your workspace has two-factor authentication enabled, resetting your password does **not** disable 2FA. You'll still need your authenticator app or backup code on your next sign-in. See "Setting up two-factor authentication" if you also need to reset your 2FA device.

### Still stuck?

If none of the above works, reach out to support with the email address on your account and roughly when you last successfully signed in — that helps us track down account-specific delivery issues quickly.`,
  },
  {
    title: "Understanding your invoice and billing cycle",
    bodyMarkdown: `## Understanding your invoice and billing cycle

Every workspace on a paid plan (Pro or Enterprise) is billed on a recurring cycle tied to the date you first subscribed, or the 1st of the month for annual Enterprise contracts.

### What's on your invoice

- **Plan and seat count** — the number of active members billed for that cycle.
- **Proration** — if you added or removed seats mid-cycle, you'll see a prorated line item for the partial period.
- **Add-ons** — any optional add-ons enabled for your workspace (for example extra storage).
- **Taxes** — calculated based on your billing address.

### Changing your plan mid-cycle

- **Upgrading** (Free → Pro, Pro → Enterprise) takes effect immediately, and you're charged a prorated amount for the remainder of the current cycle.
- **Downgrading** takes effect at the **start of your next cycle** — you keep your current plan's features until then, and your next invoice reflects the new, lower plan.

A quick summary:

\`\`\`text
Upgrade  -> effective immediately, prorated charge this cycle
Downgrade -> effective next cycle, no partial-cycle refund
\`\`\`

### Adding or removing seats

Seats are billed per active member. Adding a member mid-cycle prorates the remaining days in that cycle onto your next invoice. Removing a member stops billing for that seat starting the next cycle — there are no partial-cycle refunds for removed seats.

### Where to find past invoices

Workspace admins can view and download every past invoice from **Settings > Billing > Invoice history**. Each invoice links back to the exact seat count and plan active on that date, which is the fastest way to confirm whether a charge matches an upgrade, downgrade, or renewal.

### Disputing a charge

If a charge looks wrong — for example a duplicate charge, or an invoice that doesn't reflect a downgrade you made — contact support with the invoice number. We can look up the exact plan and seat count that was active at the time the invoice was generated and issue a refund if it was billed in error.`,
  },
  {
    title: "Connecting the Slack integration",
    bodyMarkdown: `## Connecting the Slack integration

The Slack integration lets your team turn Slack messages into tickets and post ticket notifications back into a Slack channel, so support activity doesn't require switching apps.

### Prerequisites

- You must be a **workspace admin** to install the integration.
- Your Slack workspace admin needs to approve the OAuth installation (unless your Slack workspace allows members to install apps).

### Connecting your workspace

1. Go to **Settings > Integrations > Slack**.
2. Click **Connect Slack workspace**.
3. You'll be redirected to Slack's authorization screen. Review the requested permissions — the integration requests \`channels:read\`, \`chat:write\`, and \`channels:history\` so it can post notifications and read messages in channels it's invited to.
4. Click **Allow**. You'll be redirected back and see a "Connected" status.
5. Invite the integration's bot user to any channel you want it to monitor: \`/invite @Huddlebase\`.

### Turning Slack messages into tickets

Once the bot is in a channel, react to any message with the 🎫 emoji to create a ticket from it. The original Slack thread becomes the ticket's internal note history, and public replies from agents post back into the Slack thread automatically.

### Posting notifications to a channel

Under **Settings > Integrations > Slack > Notifications**, choose which channel receives:

- New ticket created
- SLA breach warnings
- Ticket reassigned

### Troubleshooting sync gaps

If messages stop syncing after previously working:

- Confirm the bot user hasn't been removed from the channel (Slack removes app access if a channel's membership changes significantly).
- Check **Settings > Integrations > Slack** for a "Needs reauthorization" banner — Slack tokens can expire if the app was reinstalled on the Slack side.
- As a last resort, disconnect and reconnect the integration; this doesn't affect tickets already created.

### Disconnecting

Disconnecting from **Settings > Integrations > Slack > Disconnect** stops all future syncing immediately but does not delete any tickets or messages already created from Slack activity.`,
  },
  {
    title: "Exporting your data (CSV and API)",
    bodyMarkdown: `## Exporting your data (CSV and API)

You own your data. Huddlebase supports exporting tickets, contacts, and reports both from the UI and programmatically via the API — useful for internal BI dashboards, finance reporting, or a full account migration.

### Exporting from the UI

1. From the ticket list, apply any filters you want (status, tag, custom field, date range).
2. Click **Export > CSV** in the top-right of the list.
3. The export includes every column visible in your current view, including custom fields and the Assigned To column.
4. Large exports (over 5,000 rows) are emailed to you as a download link instead of a direct browser download.

### What's included in a CSV export

- Ticket number, subject, status, priority
- Contact name, email, company
- Assignee
- Tags and custom field values
- Created / resolved timestamps

### Exporting via the API

For recurring or automated exports, use the REST export endpoint instead of the UI:

\`\`\`bash
curl -H "Authorization: Bearer $HUDDLEBASE_API_KEY" \\
  "https://api.huddlebase.example/v1/tickets/export?format=csv&status=RESOLVED"
\`\`\`

The API supports the same filters as the UI (status, tag, date range) as query parameters, and returns either \`format=csv\` or \`format=json\`.

### Rate limits and pagination

API exports are paginated at 1,000 rows per page using a \`cursor\` query parameter returned in each response. Full-workspace exports should page through results rather than requesting everything in a single call, especially on larger workspaces.

### Contact exports

Contacts can be exported the same way from the **Contacts** list — useful for syncing into a CRM. Note that contact notes are included in the export but are treated as internal-only data; strip that column before sharing the file externally.

### A note on missing columns

If an expected column (like Assigned To) is missing from a CSV export you already have, it likely means the export was generated before that column was added to exports — re-export to pick up the latest columns.`,
  },
  {
    title: "Setting up two-factor authentication",
    bodyMarkdown: `## Setting up two-factor authentication

Two-factor authentication (2FA) adds a second verification step at sign-in, using a time-based code from an authenticator app in addition to your password.

### Enabling 2FA on your account

1. Go to **Settings > Security > Two-Factor Authentication**.
2. Click **Enable two-factor authentication**.
3. Scan the displayed QR code with an authenticator app (Google Authenticator, Authy, 1Password, and similar apps all work — any app implementing standard TOTP).
4. Enter the 6-digit code the app generates to confirm setup.
5. Save the provided backup codes somewhere safe — each one can be used once if you lose access to your authenticator app.

### Signing in with 2FA enabled

After entering your password, you'll be prompted for a 6-digit code:

\`\`\`text
Enter the 6-digit code from your authenticator app: ______
\`\`\`

Codes rotate every 30 seconds, so if a code is rejected, wait for the next one and try again — this is usually a clock-drift issue on the device generating the code.

### If codes never seem to work

- Confirm the device's clock is set to automatic/network time. TOTP codes are time-based; a device more than ~30-60 seconds off will generate codes that fail.
- Make sure you scanned the QR code for the correct account if you manage multiple Huddlebase workspaces — each has its own 2FA secret.
- Try a backup code instead, then re-enroll a fresh authenticator entry from Settings.

### Losing access to your authenticator app

If you lose your device and don't have backup codes saved, a workspace admin can disable 2FA on your account from **Settings > Team > [your name] > Reset 2FA**. You'll be prompted to re-enroll on your next sign-in.

### Enforcing 2FA workspace-wide

Admins can require 2FA for all members under **Settings > Security > Require 2FA for all members**. Members without 2FA enabled will be prompted to set it up on their next sign-in after enforcement is turned on.`,
  },
  {
    title: "Troubleshooting failed webhook deliveries",
    bodyMarkdown: `## Troubleshooting failed webhook deliveries

Webhooks let Huddlebase notify an external system (like a warehouse or CRM) whenever a ticket event happens. This guide covers what to check when deliveries start failing.

### How delivery and retries work

When an event fires, we send a signed \`POST\` request to your configured endpoint. If your endpoint doesn't respond with a \`2xx\` status within 10 seconds, the delivery is retried with exponential backoff:

\`\`\`text
Attempt 1: immediate
Attempt 2: +1 minute
Attempt 3: +5 minutes
Attempt 4: +30 minutes
Attempt 5 (final): +2 hours
\`\`\`

After the final attempt fails, the event is marked **failed** and no further retries happen automatically for that event.

### Checking delivery status

Go to **Settings > Integrations > Webhooks** and click into your endpoint to see a log of recent deliveries, including the HTTP status code and response body your endpoint returned for each attempt.

### Common causes of failure

- **Endpoint returning a non-2xx status** — most often a \`500\` from an unhandled exception in your receiving code, or a \`401\`/\`403\` if a signing secret rotated on your end.
- **Timeouts** — if your endpoint does slow processing (like a database write) before responding, move that work to a background job and respond \`200\` immediately.
- **TLS/certificate issues** — an expired or self-signed certificate on your endpoint will cause every delivery to fail silently from our side (no HTTP status is even returned).
- **Endpoint URL changed** — double-check the configured URL still matches your current infrastructure, especially after a domain migration.

### Verifying the signature

Every webhook request includes an \`X-Huddlebase-Signature\` header, an HMAC-SHA256 of the raw request body using your endpoint's signing secret. Reject any request whose computed signature doesn't match — this protects your endpoint from spoofed events.

### Manually replaying a failed event

From the delivery log, click **Replay** next to any failed event to resend it immediately, without waiting for or affecting the retry schedule of other events. This is the fastest way to recover once you've fixed the root cause on your end.

### If retries are completely exhausted workspace-wide

If every webhook has been failing for an extended period, check whether your endpoint's health check or firewall rules recently changed — outbound IP allowlisting is the most common cause of a sudden, total delivery outage rather than an intermittent one.`,
  },
];
