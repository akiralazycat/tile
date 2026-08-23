export type SourceKind = "rss" | "atom" | "json-feed" | "web-page";

export type TileItem = {
  title: string;
  description?: string;
  url?: string;
  image?: string;
  date?: string;
};

export type TileSource = {
  requestedUrl: string;
  resolvedUrl: string;
  title: string;
  description?: string;
  siteName?: string;
  favicon?: string;
  image?: string;
  kind: SourceKind;
  feedUrl?: string;
  fetchedAt: string;
  refreshMinutes: number;
  items: TileItem[];
};

export type InspectResponse =
  | { ok: true; source: TileSource }
  | { ok: false; error: string };
