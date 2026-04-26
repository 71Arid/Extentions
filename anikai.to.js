// ==MiruExtension==
// @name         AnimeKai
// @version      v0.3.1
// @author       miru-user
// @lang         en
// @license      MIT
// @icon         https://anikai.to/assets/img/logo.png
// @package      anikai.to
// @type         bangumi
// @webSite      https://anikai.to
// @nsfw         false
// ==/MiruExtension==

export default class extends Extension {

  async _get(path) {
    // FIXED: Proper URL construction
    let url;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      url = path;
    } else {
      // Remove leading slash if present to avoid double slash
      const cleanPath = path.startsWith('/') ? path : '/' + path;
      url = `https://anikai.to${cleanPath}`;
    }
    
    console.log(`Requesting: ${url}`);
    
    return this.request(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://anikai.to/",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  }

  // Parse anime cards from the browser page
  _parseCards(html) {
    const page = typeof html === "string" ? html : String(html);
    const videos = [];
    
    // Match each anime card
    const cardRegex = /<div class="aitem"[^>]*>[\s\S]*?<a href="(\/watch\/[^"]+)"[^>]*class="poster"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"[^>]*>[\s\S]*?<\/a>[\s\S]*?<a[^>]*class="title"[^>]*>([^<]+)<\/a>[\s\S]*?<div class="info"[^>]*>([\s\S]*?)<\/div>/gi;
    
    let match;
    while ((match = cardRegex.exec(page)) !== null) {
      const url = match[1];
      let cover = match[2];
      const title = match[3].trim();
      const infoHtml = match[4];
      
      // Fix cover URL
      if (cover && cover.startsWith('//')) {
        cover = `https:${cover}`;
      } else if (cover && !cover.startsWith('http')) {
        cover = `https://static.anikai.to${cover}`;
      }
      
      // Extract episode info
      let episodeCount = "";
      const episodeMatch = infoHtml.match(/<span[^>]*><b>(\d+)<\/b><\/span>/);
      if (episodeMatch) {
        episodeCount = episodeMatch[1];
      }
      
      let updateText = "";
      if (episodeCount) {
        updateText = `${episodeCount} eps`;
      }
      
      videos.push({
        url: url,
        title: title,
        cover: cover,
        update: updateText,
      });
    }
    
    // Fallback: simpler parsing if regex fails
    if (videos.length === 0) {
      const simpleRegex = /<a href="(\/watch\/[^"]+)"[^>]*class="title"[^>]*>([^<]+)<\/a>/g;
      let simpleMatch;
      while ((simpleMatch = simpleRegex.exec(page)) !== null) {
        videos.push({
          url: simpleMatch[1],
          title: simpleMatch[2].trim(),
          cover: "",
          update: "",
        });
      }
    }
    
    console.log(`Parsed ${videos.length} anime from page`);
    return videos;
  }

  async latest(page) {
    const p = page || 1;
    const res = await this._get(`/browser?page=${p}`);
    return this._parseCards(res);
  }

  async search(kw, page) {
    const p = page || 1;
    const encodedKw = encodeURIComponent(kw);
    console.log(`Searching for: ${kw}, page: ${p}`);
    
    const res = await this._get(`/browser?keyword=${encodedKw}&page=${p}`);
    const results = this._parseCards(res);
    
    console.log(`Found ${results.length} results for "${kw}"`);
    return results;
  }

  async detail(url) {
    const raw = await this._get(url);
    const page = typeof raw === "string" ? raw : String(raw);
    
    // Extract title
    let title = "Unknown Title";
    const titleMatch = page.match(/<h1[^>]*>([^<]+)<\/h1>/) ||
                      page.match(/property="og:title"\s+content="([^"]+)"/);
    if (titleMatch) {
      title = titleMatch[1].replace(/ - AnimeKAI$/i, '').trim();
    }
    
    // Extract cover
    let cover = "";
    const coverMatch = page.match(/property="og:image"\s+content="([^"]+)"/) ||
                      page.match(/<img[^>]+class="[^"]*poster[^"]*"[^>]+src="([^"]+)"/);
    if (coverMatch) cover = coverMatch[1];
    
    // Extract description
    let desc = "No description available.";
    const descMatch = page.match(/<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]+?)<\/div>/);
    if (descMatch) {
      desc = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (desc.length > 500) desc = desc.substring(0, 500) + "...";
    }
    
    // Get anime ID for episodes
    let aniId = "";
    const idMatch = page.match(/data-id=["'](\d+)["']/);
    if (idMatch) {
      aniId = idMatch[1];
    }
    
    // Return with placeholder episodes
    return {
      title: title,
      cover: cover,
      desc: desc,
      episodes: [{
        title: "Episodes",
        urls: aniId ? [{ name: "Coming Soon", url: `ani_id:${aniId}` }] : []
      }]
    };
  }

  async watch(rawUrl) {
    // Placeholder - returns a test stream
    if (rawUrl.startsWith('ani_id:')) {
      const aniId = rawUrl.split(':')[1];
      console.log(`Would load episodes for anime ID: ${aniId}`);
    }
    
    // Return a public test stream
    return {
      type: "hls",
      url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      subtitles: []
    };
  }

  async createFilter() {
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
          Action: "47",
          Adventure: "1",
          Comedy: "7",
          Drama: "66",
          Fantasy: "34",
          Horror: "421",
          Romance: "145",
          "Sci-Fi": "36",
          "Slice of Life": "125",
          Sports: "10",
          Thriller: "241",
        },
      },
      Type: {
        title: "Type",
        max: 1,
        min: 0,
        default: "",
        options: {
          TV: "tv",
          Movie: "movie",
          OVA: "ova",
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
        },
      },
    };
  }
}
