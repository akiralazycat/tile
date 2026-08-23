import { lookup } from "node:dns/promises";
import { NextRequest, NextResponse } from "next/server";
import type { SourceKind, TileItem, TileSource } from "@/lib/tile";

export const runtime = "nodejs";

const MAX_BYTES = 2_500_000;
const USER_AGENT =
  "Tile/0.1 (+https://github.com/akiralazycat/tile; web-to-widget source inspector)";

function decodeEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

function cleanText(value?: string | null) {
  if (!value) return undefined;
  const cleaned = decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

function attr(tag: string, name: string) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "") || undefined;
}

function absoluteUrl(value: string | undefined, base: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isPrivateIp(address: string) {
  const ip = address.toLowerCase();
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(ip)) return true;
  if (ip.startsWith("::ffff:")) return isPrivateIp(ip.slice(7));

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function validateRemoteUrl(input: string) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http:// and https:// URLs are supported.");
  }
  if (url.username || url.password) throw new Error("Credentialed URLs are not supported.");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Local or private network URLs cannot be inspected.");
  }
  if (isPrivateIp(hostname)) throw new Error("Private network URLs cannot be inspected.");

  const results = await lookup(hostname, { all: true, verbatim: true });
  if (!results.length || results.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The URL resolves to a private or unavailable network address.");
  }
  return url;
}

async function fetchSafe(input: string) {
  let url = (await validateRemoteUrl(input)).toString();

  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetch(url, {
      headers: {
        accept: "text/html, application/rss+xml, application/atom+xml, application/feed+json, application/json;q=0.9, */*;q=0.5",
        "user-agent": USER_AGENT,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The source returned an invalid redirect.");
      url = (await validateRemoteUrl(new URL(location, url).toString())).toString();
      continue;
    }

    if (!response.ok) throw new Error(`The source returned HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_BYTES) throw new Error("The source is too large to inspect safely.");

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new Error("The source is too large to inspect safely.");

    return {
      body: new TextDecoder("utf-8").decode(bytes),
      contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
      url,
    };
  }
  throw new Error("The source redirected too many times.");
}

function tagText(block: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    const text = cleanText(match?.[1]);
    if (text) return text;
  }
  return undefined;
}

function detectImage(block: string, base: string) {
  const candidates = block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/gi) ?? [];
  for (const tag of candidates) {
    const url = absoluteUrl(attr(tag, "url"), base);
    const type = attr(tag, "type") ?? "";
    if (url && (!type || type.startsWith("image/"))) return url;
  }
  return undefined;
}

function recommendRefresh(items: TileItem[], fallback = 30) {
  const newest = items
    .map((item) => (item.date ? Date.parse(item.date) : NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (!newest) return fallback;
  const ageHours = Math.max(0, (Date.now() - newest) / 3_600_000);
  if (ageHours < 2) return 10;
  if (ageHours < 24) return 20;
  if (ageHours < 168) return 60;
  return 180;
}

function parseRss(xml: string, base: string, requestedUrl: string): TileSource {
  const channel = xml.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1] ?? xml;
  const itemBlocks = channel.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  const items = itemBlocks.slice(0, 12).map((block) => {
    const link = tagText(block, ["link", "guid"]);
    return {
      title: tagText(block, ["title"]) ?? "Untitled",
      description: tagText(block, ["description", "content:encoded"]),
      url: absoluteUrl(link, base),
      image: detectImage(block, base),
      date: tagText(block, ["pubDate", "dc:date", "date"]),
    } satisfies TileItem;
  });

  const imageBlock = channel.match(/<image\b[^>]*>([\s\S]*?)<\/image>/i)?.[1];
  return {
    requestedUrl,
    resolvedUrl: base,
    title: tagText(channel, ["title"]) ?? new URL(base).hostname,
    description: tagText(channel, ["description", "subtitle"]),
    siteName: tagText(channel, ["title"]),
    favicon: absoluteUrl(imageBlock ? tagText(imageBlock, ["url"]) : undefined, base),
    kind: "rss",
    feedUrl: base,
    fetchedAt: new Date().toISOString(),
    refreshMinutes: recommendRefresh(items),
    items,
  };
}

function atomLink(block: string, base: string) {
  const tags = block.match(/<link\b[^>]*>/gi) ?? [];
  const preferred = tags.find((tag) => !attr(tag, "rel") || attr(tag, "rel") === "alternate") ?? tags[0];
  return absoluteUrl(preferred ? attr(preferred, "href") : undefined, base);
}

function parseAtom(xml: string, base: string, requestedUrl: string): TileSource {
  const entryBlocks = xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) ?? [];
  const items = entryBlocks.slice(0, 12).map((block) => ({
    title: tagText(block, ["title"]) ?? "Untitled",
    description: tagText(block, ["summary", "content"]),
    url: atomLink(block, base),
    date: tagText(block, ["updated", "published"]),
  }));

  return {
    requestedUrl,
    resolvedUrl: base,
    title: tagText(xml, ["title"]) ?? new URL(base).hostname,
    description: tagText(xml, ["subtitle"]),
    siteName: tagText(xml, ["title"]),
    kind: "atom",
    feedUrl: base,
    fetchedAt: new Date().toISOString(),
    refreshMinutes: recommendRefresh(items),
    items,
  };
}

function parseJsonFeed(body: string, base: string, requestedUrl: string): TileSource {
  const json = JSON.parse(body) as {
    title?: string;
    description?: string;
    home_page_url?: string;
    icon?: string;
    favicon?: string;
    items?: Array<{
      title?: string;
      summary?: string;
      content_text?: string;
      content_html?: string;
      url?: string;
      external_url?: string;
      image?: string;
      date_published?: string;
      date_modified?: string;
    }>;
  };

  const items: TileItem[] = (json.items ?? []).slice(0, 12).map((item) => ({
    title: cleanText(item.title) ?? cleanText(item.content_text)?.slice(0, 90) ?? "Untitled",
    description: cleanText(item.summary ?? item.content_text ?? item.content_html)?.slice(0, 240),
    url: absoluteUrl(item.url ?? item.external_url, base),
    image: absoluteUrl(item.image, base),
    date: item.date_published ?? item.date_modified,
  }));

  return {
    requestedUrl,
    resolvedUrl: absoluteUrl(json.home_page_url, base) ?? base,
    title: cleanText(json.title) ?? new URL(base).hostname,
    description: cleanText(json.description),
    favicon: absoluteUrl(json.favicon ?? json.icon, base),
    kind: "json-feed",
    feedUrl: base,
    fetchedAt: new Date().toISOString(),
    refreshMinutes: recommendRefresh(items),
    items,
  };
}

function htmlMeta(html: string, key: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const normalizedKey = key.toLowerCase();
  for (const tag of tags) {
    const name = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (name === normalizedKey) return cleanText(attr(tag, "content"));
  }
  return undefined;
}

function findFeedLink(html: string, base: string) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const type = (attr(tag, "type") ?? "").toLowerCase();
    if (rel.includes("alternate") && /rss|atom|feed\+json/.test(type)) {
      const url = absoluteUrl(attr(tag, "href"), base);
      if (url) return url;
    }
  }
  return undefined;
}

function faviconFromHtml(html: string, base: string) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  const icon = tags.find((tag) => (attr(tag, "rel") ?? "").toLowerCase().includes("icon"));
  return absoluteUrl(icon ? attr(icon, "href") : undefined, base) ?? new URL("/favicon.ico", base).toString();
}

function pageItems(html: string, base: string, fallbackTitle: string, fallbackDescription?: string) {
  const articleBlocks = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/gi) ?? [];
  const blocks = articleBlocks.length ? articleBlocks : [html];
  const items: TileItem[] = [];

  for (const block of blocks) {
    const headings = block.match(/<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>/gi) ?? [];
    for (const heading of headings) {
      const title = cleanText(heading);
      if (!title || title.length < 3 || items.some((item) => item.title === title)) continue;
      const index = block.indexOf(heading);
      const after = block.slice(index + heading.length, index + heading.length + 900);
      const paragraph = after.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
      const linkTag = heading.match(/<a\b[^>]*>/i)?.[0];
      items.push({
        title: title.slice(0, 140),
        description: cleanText(paragraph)?.slice(0, 240),
        url: absoluteUrl(linkTag ? attr(linkTag, "href") : undefined, base) ?? base,
      });
      if (items.length >= 8) return items;
    }
  }

  if (!items.length) {
    items.push({ title: fallbackTitle, description: fallbackDescription, url: base });
  }
  return items;
}

function parseWebPage(html: string, base: string, requestedUrl: string): TileSource {
  const title =
    htmlMeta(html, "og:title") ??
    cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ??
    new URL(base).hostname;
  const description = htmlMeta(html, "og:description") ?? htmlMeta(html, "description");
  const image = absoluteUrl(htmlMeta(html, "og:image"), base);
  const siteName = htmlMeta(html, "og:site_name") ?? new URL(base).hostname.replace(/^www\./, "");
  const items = pageItems(html, base, title, description);

  return {
    requestedUrl,
    resolvedUrl: base,
    title,
    description,
    siteName,
    favicon: faviconFromHtml(html, base),
    image,
    kind: "web-page",
    fetchedAt: new Date().toISOString(),
    refreshMinutes: 60,
    items,
  };
}

function detectKind(body: string, contentType: string): SourceKind | "html" {
  const head = body.slice(0, 800).trimStart().toLowerCase();
  if (contentType.includes("feed+json")) return "json-feed";
  if (contentType.includes("json") && head.startsWith("{")) return "json-feed";
  if (/<rss\b|<rdf:rdf\b/i.test(head)) return "rss";
  if (/<feed\b/i.test(head)) return "atom";
  return "html";
}

async function inspect(input: string) {
  const first = await fetchSafe(input);
  const firstKind = detectKind(first.body, first.contentType);
  if (firstKind === "rss") return parseRss(first.body, first.url, input);
  if (firstKind === "atom") return parseAtom(first.body, first.url, input);
  if (firstKind === "json-feed") return parseJsonFeed(first.body, first.url, input);

  const discoveredFeed = findFeedLink(first.body, first.url);
  if (discoveredFeed) {
    try {
      const feed = await fetchSafe(discoveredFeed);
      const kind = detectKind(feed.body, feed.contentType);
      if (kind === "rss") {
        const parsed = parseRss(feed.body, feed.url, input);
        parsed.resolvedUrl = first.url;
        parsed.favicon ??= faviconFromHtml(first.body, first.url);
        parsed.image ??= absoluteUrl(htmlMeta(first.body, "og:image"), first.url);
        return parsed;
      }
      if (kind === "atom") {
        const parsed = parseAtom(feed.body, feed.url, input);
        parsed.resolvedUrl = first.url;
        parsed.favicon ??= faviconFromHtml(first.body, first.url);
        parsed.image ??= absoluteUrl(htmlMeta(first.body, "og:image"), first.url);
        return parsed;
      }
      if (kind === "json-feed") {
        const parsed = parseJsonFeed(feed.body, feed.url, input);
        parsed.resolvedUrl = first.url;
        parsed.favicon ??= faviconFromHtml(first.body, first.url);
        return parsed;
      }
    } catch {
      // Feed discovery is an enhancement. Fall back to the original page if it fails.
    }
  }

  return parseWebPage(first.body, first.url, input);
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("url")?.trim();
  if (!input) {
    return NextResponse.json({ ok: false, error: "Add a URL to inspect." }, { status: 400 });
  }

  try {
    const source = await inspect(input);
    return NextResponse.json(
      { ok: true, source },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to inspect this source.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
