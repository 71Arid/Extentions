// ==MiruExtension==
// @name         AnimeKai
// @version      v0.2.0
// @author       miru-community
// @lang         en
// @license      MIT
// @icon         https://anikai.to/assets/img/logo.png
// @package      anikai.to
// @type         bangumi
// @webSite      https://anikai.to
// @nsfw         false
// ==/MiruExtension==

/**
 * AnimeKai (anikai.to) Miru Extension
 * ─────────────────────────────────────
 * Direct scraper — no third-party API required.
 *
 * HOW IT WORKS:
 *  1. search / latest  → scrape /browser page
 *  2. detail           → scrape /watch/<slug> page, get ani_id
 *  3. episodes         → GET /ajax/episodes/list?ani_id=X&_=enc(X)
 *  4. servers          → GET /ajax/links/list?token=T&_=enc(T)
 *  5. source           → GET /ajax/links/src?id=L&_=enc(L)  → m3u8
 *
 * TOKEN ENCRYPTION:
 *  AnimeKai signs every AJAX request with a `_` param produced by
 *  enc-dec.app/enc?v=<value>. That service returns a short hash.
 *  We replicate it inline using the same RC4-like algorithm they use.
 */

export default class extends Extension {

  // ─── tiny RC4-derived token encoder (matches anikai enc-dec.app) ───────────
  // The site XORs the input string against a rolling key derived from a
  // fixed seed, then base64-encodes it.  Reverse-engineered from the player JS.
  _enc(val) {
    const key = "DZmuZuXqa9O0z3b7";          // fixed site key (as of 2025-04)
    const s = [];
    const kl = key.length;
    let j = 0;
    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key.charCodeAt(i % kl)) & 255;
      [s[i], s[j]] = [s[j], s[i]];
    }
    let i = 0, jj = 0;
    const out = [];
    for (let n = 0; n < val.length; n++) {
      i = (i + 1) & 255;
      jj = (jj + s[i]) & 255;
      [s[i], s[jj]] = [s[jj], s[i]];
      out.push(val.charCodeAt(n) ^ s[(s[i] + s[jj]) & 255]);
    }
    // base64-encode the byte array
    let bin = "";
    for (const b of out) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  // ─── shared fetch helper ────────────────────────────────────────────────────
  // path  = relative path on anikai.to  OR  empty string when using Miru-Url
  // opts  = optional header overrides
  async _get(path, opts = {}) {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://anikai.to/",
      "X-Requested-With": "XMLHttpRequest",
      ...opts,
    };
    const res = await this.request(path, { headers });
    return res;
  }

  // ─── parse the card grid shared by search & latest ─────────────────────────
  _parseCards(html) {
    const cards = html.match(/<div class="ani-item"[\s\S]+?<\/a>\s*<\/div>/g) || [];
    return cards.map(card => {
      const url    = (card.match(/href="(\/watch\/[^"]+)"/)  || [])[1] || "";
      const title  = (card.match(/alt="([^"]+)"/)            || [])[1] || "";
      const cover  = (card.match(/data-src="([^"]+)"/)       ||
                      card.match(/src="([^"]+)"/)            || [])[1] || "";
      // episode badge e.g. "EP 12"
      const epBadge = (card.match(/<span[^>]*class="[^"]*ep[^"]*"[^>]*>([^<]+)</)  || [])[1]
                   || (card.match(/<div[^>]*class="[^"]*ep[^"]*"[^>]*>([^<]+)</)   || [])[1]
                   || "";
      return { title: title.trim(), url, cover, update: epBadge.trim() };
    }).filter(v => v.url);
  }

  // ─── SEARCH ─────────────────────────────────────────────────────────────────
  async search(kw, page) {
    const p   = page || 1;
    const res = await this._get(`/browser?keyword=${encodeURIComponent(kw)}&page=${p}&sort=most_relevance`);
    return this._parseCards(typeof res === "string" ? res : JSON.stringify(res));
  }

  // ─── LATEST ─────────────────────────────────────────────────────────────────
  async latest(page) {
    const p   = page || 1;
    const res = await this._get(`/browser?page=${p}&sort=updated_date`);
    return this._parseCards(typeof res === "string" ? res : JSON.stringify(res));
  }

  // ─── DETAIL ─────────────────────────────────────────────────────────────────
  async detail(url) {
    // url is like  /watch/naruto-9r5k
    const html = await this._get(url);
    const page = typeof html === "string" ? html : JSON.stringify(html);

    // ── meta ──────────────────────────────────────────────────────────────────
    const title   = (page.match(/<h2[^>]*class="[^"]*ani-name[^"]*"[^>]*>([^<]+)</) ||
                     page.match(/<title>([^<|]+)/)                                   || [])[1]?.trim() || url;
    const cover   = (page.match(/class="[^"]*poster[^"]*"[\s\S]{0,200}?src="([^"]+)"/) ||
                     page.match(/property="og:image"\s+content="([^"]+)"/)           || [])[1] || "";
    const desc    = (page.match(/<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]+?)<\/div>/) ||
                     page.match(/<p[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]+?)<\/p>/)     || [])[1]
                      ?.replace(/<[^>]+>/g, "").trim() || "No description.";

    // ── ani_id (needed for episode list AJAX) ─────────────────────────────────
    // The page embeds it as  data-id="XXXXX"  on the episode section or the
    // watch button.  Fall back to extracting the 4-char suffix from the slug.
    let aniId = (page.match(/data-id="(\d+)"/)                 ||
                 page.match(/ani_id['":\s]+["']?(\d+)["']?/)   || [])[1];
    if (!aniId) {
      // e.g. /watch/naruto-9r5k  → 9r5k
      const slug = url.split("/").pop();
      aniId = (slug.match(/-([a-z0-9]{4})$/) || [])[1] || "";
    }

    // ── episode list ──────────────────────────────────────────────────────────
    // GET /ajax/episodes/list?ani_id=<id>&_=<enc(id)>
    const epEnc  = this._enc(String(aniId));
    const epJson = await this._get(`/ajax/episodes/list?ani_id=${aniId}&_=${encodeURIComponent(epEnc)}`);
    const epData = typeof epJson === "object" ? epJson : JSON.parse(typeof epJson === "string" ? epJson : "{}");
    const epHtml = epData?.result || epData?.html || "";

    // Parse <a num="1" token="NcK_..." eid="123"> elements
    const epItems = (epHtml.match(/<a[^>]+num="[^"]*"[^>]*>/g) || []).map(tag => {
      const num   = (tag.match(/num="([^"]+)"/)   || [])[1] || "?";
      const token = (tag.match(/token="([^"]+)"/) || [])[1] || "";
      const eid   = (tag.match(/eid="([^"]+)"/)   || [])[1] || "";
      const name  = `Episode ${num}`;
      // We encode token+eid into the url field so watch() can decode it
      return { name, url: `${token}|${eid}|${url}` };
    });

    // ── determine sub/dub availability from server list of first episode ───────
    let hasSub = true, hasDub = false, hasSoftsub = false;
    if (epItems.length > 0) {
      try {
        const firstToken = epItems[epItems.length - 1].url.split("|")[0]; // last = ep1
        const srvEnc  = this._enc(firstToken);
        const srvJson = await this._get(`/ajax/links/list?token=${firstToken}&_=${encodeURIComponent(srvEnc)}`);
        const srvData = typeof srvJson === "object" ? srvJson : JSON.parse(srvJson || "{}");
        const srvHtml = srvData?.result || srvData?.html || "";
        hasSub     = srvHtml.includes("sub") || srvHtml.includes("Sub");
        hasDub     = srvHtml.includes("dub") || srvHtml.includes("Dub");
        hasSoftsub = srvHtml.includes("softsub") || srvHtml.includes("Soft");
      } catch (_) { /* best-effort */ }
    }

    // Build episode groups (one per available type)
    const types = [];
    if (hasSub)     types.push("sub");
    if (hasSoftsub) types.push("softsub");
    if (hasDub)     types.push("dub");
    if (types.length === 0) types.push("sub");

    const episodes = types.map(type => ({
      title: type === "sub" ? "SUB" : type === "dub" ? "DUB" : "SOFT-SUB",
      urls: [...epItems].reverse().map(ep => ({   // reverse so Ep1 appears first
        name: ep.name,
        url: `${ep.url}|${type}`,                 // append type for watch()
      })),
    }));

    return { title, cover, desc, episodes };
  }

  // ─── WATCH ──────────────────────────────────────────────────────────────────
  async watch(rawUrl) {
    // rawUrl = "<token>|<eid>|<watch_path>|<type>"
    const parts     = rawUrl.split("|");
    const token     = parts[0];
    const eid       = parts[1];
    // parts[2] is watch_path, parts[3] is type
    const streamType = parts[3] || "sub";

    // ── 1. Get list of servers for this episode ──────────────────────────────
    const srvEnc  = this._enc(token);
    const srvJson = await this._get(`/ajax/links/list?token=${token}&_=${encodeURIComponent(srvEnc)}`);
    const srvData = typeof srvJson === "object" ? srvJson : JSON.parse(srvJson || "{}");
    const srvHtml = srvData?.result || srvData?.html || "";

    // Parse  <li class="server" data-lid="XXXX" data-type="sub">
    const serverRegex = /<li[^>]*class="[^"]*server[^"]*"[^>]*data-lid="([^"]+)"[^>]*data-type="([^"]+)"[^>]*>/g;
    const servers = [];
    let m;
    while ((m = serverRegex.exec(srvHtml)) !== null) {
      servers.push({ lid: m[1], type: m[2] });
    }

    // Filter to the requested type; fall back to any server if none match
    const matching = servers.filter(s => s.type === streamType);
    const serverList = matching.length > 0 ? matching : servers;

    if (serverList.length === 0) {
      throw new Error("No streaming servers found for this episode.");
    }

    // ── 2. Get the actual m3u8 link from the first available server ──────────
    let m3u8Url = null;
    let subs    = [];

    for (const srv of serverList) {
      try {
        const srcEnc  = this._enc(srv.lid);
        const srcJson = await this._get(`/ajax/links/src?id=${srv.lid}&_=${encodeURIComponent(srcEnc)}`);
        const srcData = typeof srcJson === "object" ? srcJson : JSON.parse(srcJson || "{}");

        // Response shape: { result: { url: "https://...", tracks: [...] } }
        const result = srcData?.result || srcData;

        // The embed URL may be a player page we still need to resolve, OR a
        // direct m3u8.  AnimeKai typically returns an embed URL pointing to
        // their megaup/tech20hub CDN player which then has the m3u8.
        let embedUrl = result?.url || result?.link || "";

        if (!embedUrl) continue;

        // If it's already an m3u8, use it directly
        if (embedUrl.includes(".m3u8")) {
          m3u8Url = embedUrl;
          break;
        }

        // Otherwise fetch the embed player page and extract the m3u8 from it
        const embedHtml = await this.request("", {
          headers: {
            "Miru-Url": embedUrl,
            "Referer": "https://anikai.to/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          }
        });
        const embedPage = typeof embedHtml === "string" ? embedHtml : JSON.stringify(embedHtml);

        // Extract m3u8 from the embed page (common patterns)
        const m3u8Match = embedPage.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/);
        if (m3u8Match) {
          m3u8Url = m3u8Match[0].replace(/\\u002F/g, "/").replace(/\\/g, "");
        }

        // Extract subtitle tracks if present
        const trackMatches = [...embedPage.matchAll(/"file"\s*:\s*"([^"]+\.vtt[^"]*)"[^}]*"label"\s*:\s*"([^"]+)"/g)];
        subs = trackMatches.map(tm => ({ url: tm[1], title: tm[2] }));

        if (m3u8Url) break;
      } catch (e) {
        // Try next server
        continue;
      }
    }

    if (!m3u8Url) {
      throw new Error("Could not resolve a video stream. The episode may be temporarily unavailable.");
    }

    return {
      type: "hls",
      url: m3u8Url,
      subtitles: subs,
    };
  }

  // ─── FILTER (Genre + Type browser) ─────────────────────────────────────────
  async createFilter(filter) {
    // Static filter — matches the /browser page query params
    return {
      filter_main_bar: {
        title: "Browse by",
        max: 1,
        min: 0,
        default: "Genre",
        options: {
          Genre: "Genre",
          Type: "Type",
          Status: "Status",
        },
      },
      Genre: {
        title: "Genre",
        max: 3,
        min: 0,
        default: "",
        options: {
          Action: "47", Adventure: "1", Comedy: "4", Drama: "8",
          Fantasy: "9", Horror: "14", Mystery: "7", Romance: "22",
          "Sci-Fi": "24", "Slice of Life": "36", Sports: "37",
          Supernatural: "39", Thriller: "40", Ecchi: "29",
          Mecha: "18", Music: "19", Psychological: "20",
          School: "23", "Martial Arts": "17",
        },
      },
      Type: {
        title: "Type",
        max: 1,
        min: 0,
        default: "",
        options: {
          TV: "tv", Movie: "movie", OVA: "ova", ONA: "ona", Special: "special",
        },
      },
      Status: {
        title: "Status",
        max: 1,
        min: 0,
        default: "",
        options: {
          Releasing: "releasing",
          Completed: "completed",
          "Not Aired Yet": "info",
        },
      },
    };
  }
}