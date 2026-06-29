import type { Scenario } from "./types.js";

/** The behavioral scenarios scored per config + tier. */
export const SCENARIOS: Scenario[] = [
  {
    id: "store-then-retrieve", cls: "should-use",
    legs: [
      { prompt: "Remember for next time: we deploy staging with `fly deploy -a acme-staging`, then smoke-test with `npm run smoke`.", expect: { remembers: true } },
      { prompt: "Deploy staging.", expect: { discovers: true, readsFile: "acme-staging" } },
    ],
  },
  {
    id: "tool-portability", cls: "should-use",
    legs: [{ prompt: "File a Linear issue: 'login button overlaps on mobile'.", expect: { discovers: true, invokes: { tool: "linear", action: "create_issue" } } }],
  },
  {
    id: "multi-connection", cls: "should-use",
    legs: [{ prompt: "Email Josh (josh@acme.com) from my company B account to confirm tomorrow's demo.", expect: { invokes: { tool: "gmail", action: "send", connection: "acme-sales" } } }],
  },
  {
    id: "context-compose", cls: "should-use",
    legs: [{ prompt: "Draft and send the intro email for a new lead following our sales pipeline, in company Z's voice.", expect: { discovers: true, readsFile: "tone", invokes: { tool: "gmail", action: "send" } } }],
  },
  {
    id: "installed-repo-tool", cls: "should-use",
    legs: [{ prompt: "Fetch the pricing page at https://example.com/pricing — it blocks normal scrapers.", expect: { discovers: true, invokes: { tool: "cloakbrowser", action: "fetch" } } }],
  },
  {
    id: "should-use-direct", cls: "should-use",
    legs: [{ prompt: "What eslint convention do we use for Acme?", expect: { discovers: true, readsFile: "airbnb" } }],
  },
  {
    id: "negative-math", cls: "should-not-use",
    legs: [{ prompt: "What's 2 + 2?", expect: {} }],
  },
  {
    id: "negative-fizzbuzz", cls: "should-not-use",
    legs: [{ prompt: "Write a fizzbuzz function in Python.", expect: {} }],
  },
  {
    id: "ambiguous-followup", cls: "should-use",
    legs: [{ prompt: "Draft a short follow-up message to a new lead about our product.", expect: { discovers: true, readsFile: "warm, concise" } }],
  },
  {
    id: "ambiguous-lint", cls: "should-use",
    legs: [{ prompt: "Set up the linting config for this project the way it should be.", expect: { discovers: true, readsFile: "airbnb" } }],
  },
  {
    id: "ambiguous-ship", cls: "should-use",
    legs: [{ prompt: "What's the command to ship the test environment?", expect: { discovers: true, readsFile: "acme-staging" } }],
  },
];
