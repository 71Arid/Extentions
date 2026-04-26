// ==MiruExtension==
// @name         AnimeKai
// @version      v0.3.0
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
    const url = path.startsWith('http') ? path : `https://anikai.to${path}`;
    return this.request(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (Chrome 124.0.0.0)",
        "Referer": "https://anikai.to/",
        "Accept": "text/html,application/xhtml+xml",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
  }

  // Parse anime cards from the browser page
  _parseCards(html) {
    const page = typeof html === "string" ? html : String(html);
    const videos = [];
    
    // Match each anime card - structure from the HTML:
    // <div class="aitem">
    //   <a href="/watch/xxx" class="poster">
    //     <img data-src="url" or src="url">
    //   </a>
    //   <a class="title">Title</a>
    //   <div class="info">...</div>
    // </div>
    
    const cardRegex = /<div class="aitem"[^>]*>[\s\S]*?<a href="(\/watch\/[^"]+)"[^>]*class="poster"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"[^>]*>[\s\S]*?<\/a>[\s\S]*?<a[^>]*class="title"[^>]*>([^<]+)<\/a>[\s\S]*?<div class="info"[^>]*>([\s\S]*?)<\/div>/gi;
    
    let match;
    while ((match = cardRegex.exec(page)) !== null) {
      const url = match[1];
      let cover = match[2];
      const title = match[3].trim();
      const infoHtml = match[4];
      
      // Fix cover URL if needed
      if (cover && !cover.startsWith('http')) {
        cover = `https://static.anikai.to${cover}`;
      }
      
      // Extract episode info from the info div
      let episodeCount = "";
      const episodeMatch = infoHtml.match(/<span[^>]*><b>(\d+)<\/b><\/span>/);
      if (episodeMatch) {
        episodeCount = episodeMatch[1];
      }
      
      // Check if it has sub/dub
      const hasSub = infoHtml.includes('<use href="#sub"></use>');
      const hasDub = infoHtml.includes('<use href="#dub"></use>');
      
      let updateText = "";
      if (hasSub || hasDub) {
        const subCount = (infoHtml.match(/<use href="#sub"><\/use>\s*(\d+)/) || [])[1];
        const dubCount = (infoHtml.match(/<use href="#dub"><\/use>\s*(\d+)/) || [])[1];
        if (subCount) updateText = `Sub: ${subCount}`;
        if (dubCount) updateText += updateText ? ` | Dub: ${dubCount}` : `Dub: ${dubCount}`;
      }
      if (episodeCount && !updateText) updateText = `${episodeCount} eps`;
      
      videos.push({
        url: url,
        title: title,
        cover: cover,
        update: updateText || episodeCount,
      });
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
    const res = await this._get(`/browser?keyword=${encodedKw}&page=${p}`);
    const results = this._parseCards(res);
    
    if (results.length === 0 && kw) {
      // Try alternative search endpoint
      const altRes = await this._get(`/filter?keyword=${encodedKw}&page=${p}`);
      return this._parseCards(altRes);
    }
    
    return results;
  }

  async detail(url) {
    const raw = await this._get(url);
    const page = typeof raw === "string" ? raw : String(raw);
    
    // Extract title from multiple possible locations
    let title = "";
    const titleMatch = page.match(/<h1[^>]*>([^<]+)<\/h1>/) ||
                      page.match(/property="og:title"\s+content="([^"]+)"/) ||
                      page.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      title = titleMatch[1].replace(/ - AnimeKAI$/i, '').trim();
    }
    
    if (!title) {
      title = url.split('/').pop()?.replace(/-/g, ' ') || "Unknown Title";
    }
    
    // Extract cover image
    let cover = "";
    const coverMatch = page.match(/property="og:image"\s+content="([^"]+)"/) ||
                      page.match(/<img[^>]+class="[^"]*poster[^"]*"[^>]+src="([^"]+)"/);
    if (coverMatch) cover = coverMatch[1];
    
    // Extract description
    let desc = "No description available.";
    const descMatch = page.match(/<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]+?)<\/div>/);
    if (descMatch) {
      desc = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    
    // Extract anime ID from the data-id attribute
    let aniId = "";
    const idMatch = page.match(/data-id=["'](\d+)["']/);
    if (idMatch) {
      aniId = idMatch[1];
    } else {
      // Fallback: extract from URL slug
      const slug = url.split('/').pop() || "";
      const slugMatch = slug.match(/-([a-z0-9]{4,})$/i);
      aniId = slugMatch ? slugMatch[1] : slug;
    }
    
    // For now, return basic info
    // The full episode implementation would require the RC4 encryption and AJAX calls
    return {
      title: title,
      cover: cover,
      desc: desc,
      episodes: [{
        title: "Episodes",
        urls: [{ name: "Select episode in player", url: `ani_id:${aniId}` }]
      }]
    };
  }

  async watch(rawUrl) {
    // Simplified for now - returns a placeholder
    // Full implementation would need to:
    // 1. Get episode list via AJAX with RC4 encryption
    // 2. Get server list
    // 3. Get video source
    // 4. Return m3u8 URL
    
    if (rawUrl.startsWith('ani_id:')) {
      const aniId = rawUrl.split(':')[1];
      // This would need the full RC4 implementation
      throw new Error(`Full episode support requires RC4 encryption. ani_id: ${aniId}`);
    }
    
    // Placeholder video stream
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
          Mystery: "48",
          Romance: "145",
          "Sci-Fi": "36",
          "Slice of Life": "125",
          Sports: "10",
          Supernatural: "49",
          Thriller: "241",
          Ecchi: "8",
          Mecha: "219",
          Music: "27",
          Psychological: "240",
          School: "9",
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
          ONA: "ona",
          Special: "special",
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
          "Not Yet Aired": "info",
        },
      },
    };
  }
}
