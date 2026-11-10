// Crawlers that robots.txt names explicitly. Every token was checked against the
// operator's own crawler documentation (`docs`, on the `checked` date); a token that
// cannot be verified there is not listed (Cohere publishes no active crawler and
// ByteDance publishes no documentation for Bytespider, so neither appears).
//
// Groups:
//  - search-index:   builds a search or answer index. Blocking one removes the site from
//                    that engine's results, so these are always allowed.
//  - user-triggered: fetches a page because a person asked an assistant about it. Several
//                    operators state that robots.txt may not apply to these requests.
//  - training:       collects content for model training (or is a control token for it).
//                    Allowed by default; AI_TRAINING_CRAWLERS=disallow opts out.
// Pure module: no server-only imports.
export type CrawlerGroup = 'search-index' | 'user-triggered' | 'training';
export type Crawler = {
  token: string;      // robots.txt user-agent token (crawlers match it case-insensitively)
  operator: string;
  group: CrawlerGroup;
  purpose: string;    // what the operator says the crawler is for, in one line
  docs: string;       // operator documentation that lists the token
  checked: string;    // YYYY-MM-DD: the token and purpose were verified against `docs`
};

const CHECKED = '2026-11-10';
const GOOGLE_DOCS = 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers';
const OPENAI_DOCS = 'https://developers.openai.com/api/docs/bots';
const ANTHROPIC_DOCS = 'https://support.claude.com/en/articles/8896518-robots-txt-controls';
const PERPLEXITY_DOCS = 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers';
const AMAZON_DOCS = 'https://developer.amazon.com/amazonbot';
const META_DOCS = 'https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers';
const APPLE_DOCS = 'https://support.apple.com/en-us/119829';
const MISTRAL_DOCS = 'https://docs.mistral.ai/robots';

export const crawlers: readonly Crawler[] = [
  // Search and answer indexes.
  { token: 'Googlebot', operator: 'Google', group: 'search-index', purpose: 'Crawls for Google Search and its Search features.', docs: GOOGLE_DOCS, checked: CHECKED },
  { token: 'bingbot', operator: 'Microsoft', group: 'search-index', purpose: 'Crawls for Bing search. A bingbot group replaces the wildcard group, so every rule must be repeated in it.', docs: 'https://blogs.bing.com/webmaster/May-2012/To-crawl-or-not-to-crawl,-that-is-BingBot-s-questi', checked: CHECKED },
  { token: 'OAI-SearchBot', operator: 'OpenAI', group: 'search-index', purpose: "Surfaces websites in ChatGPT's search features; its setting is independent of GPTBot.", docs: OPENAI_DOCS, checked: CHECKED },
  { token: 'PerplexityBot', operator: 'Perplexity', group: 'search-index', purpose: 'Surfaces and links websites in Perplexity search results; not used to crawl content for AI foundation models.', docs: PERPLEXITY_DOCS, checked: CHECKED },
  { token: 'Claude-SearchBot', operator: 'Anthropic', group: 'search-index', purpose: 'Navigates the web to improve search result quality for Claude users.', docs: ANTHROPIC_DOCS, checked: CHECKED },
  { token: 'Amzn-SearchBot', operator: 'Amazon', group: 'search-index', purpose: 'Improves search experiences in Amazon products such as Alexa; does not crawl for generative AI training.', docs: AMAZON_DOCS, checked: CHECKED },
  { token: 'meta-webindexer', operator: 'Meta', group: 'search-index', purpose: 'Improves Meta AI search result quality; allowing it helps Meta AI cite and link to the content.', docs: META_DOCS, checked: CHECKED },
  { token: 'Applebot', operator: 'Apple', group: 'search-index', purpose: 'Powers search features in Spotlight, Siri and Safari; use for training is controlled separately by Applebot-Extended.', docs: APPLE_DOCS, checked: CHECKED },
  { token: 'DuckAssistBot', operator: 'DuckDuckGo', group: 'search-index', purpose: "Fetches pages in real time for DuckDuckGo's AI-assisted answers, which cite their sources; not used to train AI models.", docs: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot', checked: CHECKED },
  { token: 'YouBot', operator: 'You.com', group: 'search-index', purpose: 'The crawler behind the You.com search engine; honours robots.txt.', docs: 'https://you.com/docs/youbot', checked: CHECKED },
  { token: 'MistralAI-Index', operator: 'Mistral AI', group: 'search-index', purpose: "Indexes pages for Mistral's search; the content is not used for generative AI training.", docs: MISTRAL_DOCS, checked: CHECKED },

  // Fetches made because a person asked.
  { token: 'ChatGPT-User', operator: 'OpenAI', group: 'user-triggered', purpose: 'Fetches pages for ChatGPT and Custom GPT users; OpenAI says robots.txt rules may not apply to user-initiated actions.', docs: OPENAI_DOCS, checked: CHECKED },
  { token: 'Claude-User', operator: 'Anthropic', group: 'user-triggered', purpose: 'Retrieves content when a Claude user asks a question.', docs: ANTHROPIC_DOCS, checked: CHECKED },
  { token: 'Perplexity-User', operator: 'Perplexity', group: 'user-triggered', purpose: 'Fetches a page when a Perplexity user asks about it; generally ignores robots.txt because a user requested the fetch.', docs: PERPLEXITY_DOCS, checked: CHECKED },
  { token: 'meta-externalfetcher', operator: 'Meta', group: 'user-triggered', purpose: "Fetches individual links at a user's request; may bypass robots.txt.", docs: META_DOCS, checked: CHECKED },
  { token: 'MistralAI-User', operator: 'Mistral AI', group: 'user-triggered', purpose: "Visits pages when a user's request to Mistral's assistant needs them; not used to crawl the web automatically.", docs: MISTRAL_DOCS, checked: CHECKED },
  { token: 'Amzn-User', operator: 'Amazon', group: 'user-triggered', purpose: 'Supports user actions such as Alexa queries that need current information; may not follow all robots.txt directives.', docs: AMAZON_DOCS, checked: CHECKED },

  // Model training.
  { token: 'GPTBot', operator: 'OpenAI', group: 'training', purpose: "Crawls content that may be used to train OpenAI's generative AI foundation models.", docs: OPENAI_DOCS, checked: CHECKED },
  { token: 'ClaudeBot', operator: 'Anthropic', group: 'training', purpose: "Anthropic's training crawler: collects web content that may contribute to model training.", docs: ANTHROPIC_DOCS, checked: CHECKED },
  { token: 'Google-Extended', operator: 'Google', group: 'training', purpose: 'Control token only (no separate user agent): governs use of Google-crawled content for Gemini training and grounding; no effect on Search inclusion or ranking.', docs: GOOGLE_DOCS, checked: CHECKED },
  { token: 'Applebot-Extended', operator: 'Apple', group: 'training', purpose: "Control token only (it does not crawl): governs use of Applebot-crawled data for training Apple's foundation models; no effect on Search.", docs: APPLE_DOCS, checked: CHECKED },
  { token: 'CCBot', operator: 'Common Crawl', group: 'training', purpose: "Builds Common Crawl's open repository of web crawl data, which anyone can access and analyse, so it can end up in third-party training sets.", docs: 'https://commoncrawl.org/ccbot', checked: CHECKED },
  { token: 'meta-externalagent', operator: 'Meta', group: 'training', purpose: 'Crawls the web for training foundation AI models or improving products by indexing content directly.', docs: META_DOCS, checked: CHECKED },
  { token: 'Amazonbot', operator: 'Amazon', group: 'training', purpose: 'Improves Amazon products and services; content may be used to train Amazon AI models.', docs: AMAZON_DOCS, checked: CHECKED },
  { token: 'MistralAI-Training', operator: 'Mistral AI', group: 'training', purpose: "Builds datasets for training Mistral's generative AI models; not used for search indexing.", docs: MISTRAL_DOCS, checked: CHECKED },
];

export type Access = 'allow' | 'disallow';
export type CrawlerPolicy = { training: Access };

// AI_TRAINING_CRAWLERS=allow (the default when unset or empty) or disallow. Any other value
// is treated as disallow: an opt-out that was mistyped must never be read as consent.
export function crawlerPolicy(env: NodeJS.ProcessEnv = process.env): CrawlerPolicy {
  const value = env.AI_TRAINING_CRAWLERS?.trim().toLowerCase();
  return { training: !value || value === 'allow' ? 'allow' : 'disallow' };
}

// Search and user-triggered crawlers are always allowed; training crawlers follow the policy.
export function crawlerAccess(crawler: Crawler, policy: CrawlerPolicy): Access {
  return crawler.group === 'training' ? policy.training : 'allow';
}

export function crawlersInGroup(group: CrawlerGroup): Crawler[] {
  return crawlers.filter((crawler) => crawler.group === group);
}
