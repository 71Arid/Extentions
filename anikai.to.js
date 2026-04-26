// ==MiruExtension==
// @name         AnimeKai
// @version      v0.2.1
// @author       miru-user
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
 *
 * FLOW:
 *  1. latest/search  → scrape /browser page
 *  2. detail         → scrape /watch/<slug>, extract ani_id
 *  3. episodes       → GET /ajax/episodes/list?ani_id=X&_=enc(X)
 *  4. servers        → GET /ajax/links/list?token=T&_=enc(T)
 *  5. source         → GET /ajax/links/src?id=L&_=enc(L)  → embed → m3u8
 *
 * TOKEN ENCRYPTION:
 *  Every AJAX call needs a signed "_" param.
 *  It is RC4(key, value) → base64. Key is fixed in the site JS.
 */

export default class extends Extension {

  /* ─── RC4 token encoder ──────────────────────────────────────────────────── */
  _enc(val) {
    const key = "DZmuZuXqa9O0z3b7";
    const kl  = key.length;
    const s   = Array.from({length: 256}, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key.charCodeAt(i % kl)) & 255;
      const tmp = s[i]; s[i] = s[j]; s[j] = tmp;
    }
    let ci = 0, cj = 0;
    const out = [];
    const str = String(val);
    for (let n = 0; n < str.length; n++) {
      ci = (ci + 1) & 255;
      cj = (cj + s[ci]) & 255;
      const tmp = s[ci]; s[ci] = s[cj]; s[cj] = tmp;
      out.push(str.charCodeAt(n) ^ s[(s[ci] + s[cj]) & 255]);
    }
    let bin = "";
    for (const b of out) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  /* ─── HTTP helper ─────────────────────────────────────────────────────────── */
  async _get(path) {
    return this.request(path, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer":         "https://anikai.to/",
        "X-Requested-With":"XMLHttpRequest",
      },
    });
  }

  /* For external URLs (embed players, etc.) */
  async _getUrl(url) {
    return this.request("", {
      headers: {
        "Miru-Url":        url,
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer":         "https://anikai.to/",
        "X-Requested-With":"XMLHttpRequest",
      },
    });
  }

  /* ─── Parse card grid (shared between search & latest) ──────────────────── */
  _parseCards(html) {
    const page   = typeof html === "string" ? html : JSON.stringify(html);
    // Each card is wrapped in  <div class="... ani-item ...">
    const blocks = page.match(/<div[^>]+class="[^"]*ani-item[^"]*"[\s\S]+?<\/a>\s*<\/div>/g) || [];
    const videos = [];
    for (const block of blocks) {
      const urlM   = block.match(/href="(\/watch\/[^"]+)"/);
      const titleM = block.match(/alt="([^"]+)"/);
      const coverM = block.match(/data-src="([^"]+)"/) || block.match(/src="(https:\/\/static[^"]+)"/);
      const epM    = block.match(/<span[^>]*class="[^"]*ep[^"]*"[^>]*>\s*([^<]+)\s*</);

      if (!urlM || !titleM) continue;
      videos.push({
        url:    urlM[1],
        title:  titleM[1].trim(),
        cover:  coverM ? coverM[1] : "",
        update: epM   ? epM[1].trim() : "",
      });
    }
    return videos;
  }

  /* ─── LATEST ─────────────────────────────────────────────────────────────── */
  async latest(page) {
    const p   = page || 1;
    const res = await this._get(`/browser?page=${p}&sort=updated_date`);
    return this._parseCards(res);
  }

  /* ─── SEARCH ─────────────────────────────────────────────────────────────── */
  async search(kw, page) {
    const p   = page || 1;
    const res = await this._get(`/browser?keyword=${encodeURIComponent(kw)}&page=${p}&sort=most_relevance`);
    return this._parseCards(res);
  }

  /* ─── DETAIL ─────────────────────────────────────────────────────────────── */
  async detail(url) {
    const raw  = await this._get(url);
    const page = typeof raw === "string" ? raw : JSON.stringify(raw);

    /* ── Basic metadata ─────────────────────────────────────────────────────── */
    const title = (
      page.match(/<h1[^>]*class="[^"]*anime-name[^"]*"[^>]*>([^<]+)</)  ||
      page.match(/<h2[^>]*class="[^"]*ani-name[^"]*"[^>]*>([^<]+)</)   ||
      page.match(/property="og:title"\s+content="([^"]+)"/)
    )?.[1]?.trim() || url.split("/").pop();

    const cover = (
      page.match(/property="og:image"\s+content="([^"]+)"/)               ||
      page.match(/<img[^>]+class="[^"]*poster[^"]*"[^>]+src="([^"]+)"/)
    )?.[1] || "";

    const descRaw = (
      page.match(/<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]+?)<\/div>/) ||
      page.match(/<p[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]+?)<\/p>/)
    )?.[1] || "";
    const desc = descRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "No description available.";

    /* ── ani_id extraction ──────────────────────────────────────────────────── */
    // Miru passes back whatever string was in `url` field of search results,
    // which is the relative path like /watch/naruto-9r5k
    let aniId = (
      page.match(/data-id="(\d+)"/)            ||
      page.match(/\bani_id["'\s:=]+(\d+)/)     ||
      page.match(/\banime_id["'\s:=]+(\d+)/)
    )?.[1] || "";

    // Fallback: the 4-char alphanumeric slug suffix IS the token base
    if (!aniId) {
      const slug = url.split("/").pop() || "";
      aniId = slug.match(/-([a-z0-9]{4,6})$/)?.[1] || slug;
    }

    /* ── Episode list via AJAX ──────────────────────────────────────────────── */
    const enc    = this._enc(String(aniId));
    const epRaw  = await this._get(`/ajax/episodes/list?ani_id=${aniId}&_=${encodeURIComponent(enc)}`);
    const epData = typeof epRaw === "object" ? epRaw : (() => { try { return JSON.parse(epRaw); } catch { return {}; } })();
    const epHtml = String(epData?.result || epData?.html || "");

    // <a num="1" token="ABC..." eid="123" title="Episode title">
    const epMatches = [...epHtml.matchAll(/<a[^>]+num="([^"]+)"[^>]+token="([^"]+)"[^>]+eid="([^"]+)"[^>]*>/g)];
    const rawEps = epMatches.map(m => ({
      num:   m[1],
      token: m[2],
      eid:   m[3],
    }));

    /* ── Detect sub/dub/softsub from the first episode's server list ─────────  */
    let types = ["sub"]; // default
    if (rawEps.length > 0) {
      try {
        const firstToken = rawEps[0].token;
        const srvEnc     = this._enc(firstToken);
        const srvRaw     = await this._get(`/ajax/links/list?token=${firstToken}&_=${encodeURIComponent(srvEnc)}`);
        const srvData    = typeof srvRaw === "object" ? srvRaw : (() => { try { return JSON.parse(srvRaw); } catch { return {}; } })();
        const srvHtml    = String(srvData?.result || srvData?.html || "");

        // data-type="sub" / data-type="dub" / data-type="softsub"
        const foundTypes = new Set(
          [...srvHtml.matchAll(/data-type="(sub|dub|softsub)"/g)].map(m => m[1])
        );
        if (foundTypes.size > 0) types = [...foundTypes];
      } catch (_) { /* keep default */ }
    }

    /* ── Build episode groups ──────────────────────────────────────────────── */
    // Encode everything the watch() method needs into the url string:
    // "<token>||<eid>||<type>"
    // (double-pipe separator avoids conflicts with base64 chars)
    const episodes = types.map(type => ({
      title: type === "sub" ? "SUB" : type === "dub" ? "DUB" : "SOFT-SUB",
      urls:  [...rawEps].reverse().map((ep, idx) => ({
        name: `Episode ${ep.num}`,
        url:  `${ep.token}||${ep.eid}||${type}`,
      })),
    }));

    return { title, cover, desc, episodes };
  }

  /* ─── WATCH ──────────────────────────────────────────────────────────────── */
  async watch(rawUrl) {
    // rawUrl = "<token>||<eid>||<type>"
    const [token, eid, streamType = "sub"] = rawUrl.split("||");

    /* 1. Get server list for this episode */
    const srvEnc  = this._enc(token);
    const srvRaw  = await this._get(`/ajax/links/list?token=${token}&_=${encodeURIComponent(srvEnc)}`);
    const srvData = typeof srvRaw === "object" ? srvRaw : (() => { try { return JSON.parse(srvRaw); } catch { return {}; } })();
    const srvHtml = String(srvData?.result || srvData?.html || "");

    // <li class="server" data-lid="XXXX" data-type="sub">
    const allServers = [...srvHtml.matchAll(/data-lid="([^"]+)"[^>]*data-type="([^"]+)"/g)]
      .map(m => ({ lid: m[1], type: m[2] }));

    // Prefer requested type; fall back to any server
    const preferred = allServers.filter(s => s.type === streamType);
    const serverList = preferred.length > 0 ? preferred : allServers;

    if (serverList.length === 0) {
      throw new Error(`No servers found. (token=${token}, type=${streamType})`);
    }

    /* 2. Try each server until we get an m3u8 */
    let m3u8 = "";
    let subs  = [];

    for (const srv of serverList) {
      try {
        const srcEnc  = this._enc(srv.lid);
        const srcRaw  = await this._get(`/ajax/links/src?id=${srv.lid}&_=${encodeURIComponent(srcEnc)}`);
        const srcData = typeof srcRaw === "object" ? srcRaw : (() => { try { return JSON.parse(srcRaw); } catch { return {}; } })();

        const result   = srcData?.result || srcData || {};
        const embedUrl = String(result?.url || result?.link || result?.src || "");

        if (!embedUrl) continue;

        // Direct m3u8?
        if (embedUrl.match(/\.m3u8/)) {
          m3u8 = embedUrl;
          break;
        }

        // Otherwise resolve through the embed player page
        const embedRaw  = await this._getUrl(embedUrl);
        const embedPage = typeof embedRaw === "string" ? embedRaw : JSON.stringify(embedRaw);

        // Most AnimeKai CDN players put the m3u8 in a "sources" JSON array
        // Pattern: {"file":"https://...1080.m3u8"}  or  file: "..."
        const directM3u8 = embedPage.match(/https?:\/\/[^"'\s\\]+\.m3u8(?:[^"'\s\\]*)?/);
        if (directM3u8) {
          m3u8 = directM3u8[0].replace(/\\u002F/g, "/").replace(/\\/g, "");
        }

        // Subtitles
        const trackMatches = [...embedPage.matchAll(/"file"\s*:\s*"([^"]+\.(?:vtt|srt)[^"]*)"[^}]*?"label"\s*:\s*"([^"]+)"/g)];
        subs = trackMatches.map(tm => ({ url: tm[1], title: tm[2] }));

        if (m3u8) break;
      } catch (_) {
        continue;
      }
    }

    if (!m3u8) {
      throw new Error("Could not resolve a video stream for this episode. Try another server or episode.");
    }

    return {
      type:      "hls",
      url:       m3u8,
      subtitles: subs,
    };
  }

  /* ─── FILTER ─────────────────────────────────────────────────────────────── */
  async createFilter() {
    return {
      filter_main_bar: {
        title:   "Browse by",
        max:     1,
        min:     0,
        default: "Genre",
        options: {
          Genre:  "Genre",
          Type:   "Type",
          Status: "Status",
        },
      },
      Genre: {
        title:   "Genre",
        max:     3,
        min:     0,
        default: "",
        options: {
          Action:       "47",
          Adventure:    "1",
          Comedy:       "4",
          Drama:        "8",
          Fantasy:      "9",
          Horror:       "14",
          Mystery:      "7",
          Romance:      "22",
          "Sci-Fi":     "24",
          "Slice of Life": "36",
          Sports:       "37",
          Supernatural: "39",
          Thriller:     "40",
          Ecchi:        "29",
          Mecha:        "18",
          Music:        "19",
          Psychological:"20",
          School:       "23",
        },
      },
      Type: {
        title:   "Type",
        max:     1,
        min:     0,
        default: "",
        options: {
          TV:      "tv",
          Movie:   "movie",
          OVA:     "ova",
          ONA:     "ona",
          Special: "special",
        },
      },
      Status: {
        title:   "Status",
        max:     1,
        min:     0,
        default: "",
        options: {
          Releasing:    "releasing",
          Completed:    "completed",
          "Not Aired":  "info",
        },
      },
    };
  }
}
