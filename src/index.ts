import { tool } from "@opencode-ai/plugin";
import { AuthenticationError, Search1API } from "@search1api/client";
import { Credentials } from "./auth.js";
import { startOAuth } from "./oauth.js";
import {
  API_BASE,
  PROVIDER,
  serviceURL,
  type Options,
  type PluginInput,
  type StoredOAuth,
} from "./types.js";

export const Search1APIPlugin = async (
  input: PluginInput,
  options: Options = {},
) => {
  if (options.apiKey !== undefined && typeof options.apiKey !== "string")
    throw new Error("apiKey must be a string.");
  const baseUrl = serviceURL(options.baseUrl ?? API_BASE).href.replace(
    /\/$/,
    "",
  );
  const credentials = new Credentials(input, options);
  const query = tool.schema.string().trim().min(1).describe("Search query.");
  const maxResults = tool.schema.number().int().min(1).max(50).optional();
  const timeRange = tool.schema
    .enum(["day", "week", "month", "year"])
    .optional();
  const filters = {
    maxResults,
    crawlResults: tool.schema.number().int().min(0).max(50).optional(),
    includeSites: tool.schema.array(tool.schema.string()).optional(),
    excludeSites: tool.schema.array(tool.schema.string()).optional(),
    timeRange,
  };
  async function execute(
    signal: AbortSignal,
    call: (client: Search1API) => Promise<unknown>,
  ) {
    let auth = await credentials.token(signal);
    signal.throwIfAborted();
    const client = () =>
      new Search1API({ apiKey: auth.token, baseUrl, maxRetries: 0 });
    let result: unknown;
    try {
      result = await call(client());
    } catch (error) {
      if (!(error instanceof AuthenticationError) || !auth.oauth) throw error;
      const renewed = await credentials.renew(auth.oauth, signal);
      auth = { token: renewed.access, oauth: renewed };
      signal.throwIfAborted();
      result = await call(client());
    }
    return JSON.stringify(result, null, 2);
  }
  return {
    config: async (config: { provider?: Record<string, unknown> }) => {
      config.provider ??= {};
      // This entry supplies sign-in, not chat models.
      config.provider[PROVIDER] ??= { name: "Search1API", models: {} };
    },
    auth: {
      provider: PROVIDER,
      single: true,
      methods: [
        {
          type: "oauth" as const,
          label: "Sign in to Search1API",
          authorize: () => startOAuth(baseUrl),
        },
        { type: "api" as const, label: "Search1API API key" },
      ],
      refreshLead: 60_000,
      refresh: (auth: StoredOAuth) => credentials.renew(auth),
    },
    tool: {
      search: tool({
        description:
          "Search the live web for current facts, research, documentation, people, companies and sources. Credit Grokipedia results as Powered by xAI.",
        args: {
          query,
          ...filters,
          searchService: tool.schema
            .enum([
              "google",
              "bing",
              "bingcn",
              "duckduckgo",
              "yahoo",
              "yandex",
              "x",
              "reddit",
              "github",
              "youtube",
              "arxiv",
              "wechat",
              "bilibili",
              "imdb",
              "wikipedia",
              "grokipedia",
              "baidu",
              "360",
              "quark",
            ])
            .optional(),
          page: tool.schema.number().int().min(1).max(100).optional(),
        },
        execute: ({ query, ...args }, ctx) =>
          execute(ctx.abort, (c) =>
            c.search(
              query,
              {
                ...args,
                maxResults: args.maxResults ?? 10,
                searchService: args.searchService ?? "google",
                crawlResults: args.crawlResults ?? 0,
              },
              { signal: ctx.abort },
            ),
          ),
      }),
      news: tool({
        description:
          "Search current news and optionally retrieve full article content.",
        args: {
          query,
          ...filters,
          searchService: tool.schema
            .enum([
              "google",
              "bing",
              "duckduckgo",
              "yahoo",
              "hackernews",
              "reuters",
            ])
            .optional(),
        },
        execute: ({ query, ...args }, ctx) =>
          execute(ctx.abort, (c) =>
            c.news(
              query,
              {
                ...args,
                maxResults: args.maxResults ?? 10,
                searchService: args.searchService ?? "bing",
                crawlResults: args.crawlResults ?? 0,
              },
              { signal: ctx.abort },
            ),
          ),
      }),
      ask: tool({
        description:
          "Describe what to find in natural language. Search1API chooses engines and a time window and returns results ranked by relevance. Costs 5 credits; returns search results rather than a generated answer.",
        args: { query: query.max(500) },
        execute: ({ query }, ctx) =>
          execute(ctx.abort, (c) => c.ask(query, { signal: ctx.abort })),
      }),
      crawl: tool({
        description: "Retrieve clean readable content from a public URL.",
        args: { url: tool.schema.url() },
        execute: ({ url }, ctx) =>
          execute(ctx.abort, (c) => c.crawl(url, {}, { signal: ctx.abort })),
      }),
      sitemap: tool({
        description: "Discover links related to a public URL or domain.",
        args: { url: tool.schema.url() },
        execute: ({ url }, ctx) =>
          execute(ctx.abort, (c) => c.sitemap(url, {}, { signal: ctx.abort })),
      }),
      trending: tool({
        description:
          "Find trending repositories on GitHub or stories on Hacker News.",
        args: {
          service: tool.schema.enum(["github", "hackernews"]),
          maxResults,
        },
        execute: ({ service, maxResults }, ctx) =>
          execute(ctx.abort, (c) =>
            c.trending(
              service,
              { maxResults: maxResults ?? 10 },
              { signal: ctx.abort },
            ),
          ),
      }),
    },
  };
};

export default { id: "magpie-search1api", server: Search1APIPlugin };
