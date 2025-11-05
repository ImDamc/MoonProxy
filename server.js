import express from "express"
import fetch from "node-fetch"
import * as cheerio from "cheerio"
import http from "http"
import https from "https"

const app = express()
const PORT = process.env.PORT || 5000
const HOST = '0.0.0.0'

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 })

class SimpleCache {
  constructor(maxSize = 500, ttl = 300000) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.ttl = ttl
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return null
    if (Date.now() > item.expiry) {
      this.cache.delete(key)
      return null
    }
    return item.value
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttl
    })
  }

  has(key) {
    return this.get(key) !== null
  }
}

const resourceCache = new SimpleCache(500, 300000)

function rewriteCssUrls(css, baseUrl, rewriteFunc) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, url) => {
    const rewritten = rewriteFunc(url.trim(), baseUrl)
    return `url(${quote}${rewritten}${quote})`
  })
}

function isAllowedUrl(url) {
  return true
}

function normalizeInput(q) {
  if (!q) return null
  const t = q.trim()
  if (t.startsWith("http://") || t.startsWith("https://")) return t
  if (t.includes(".")) return "https://" + t
  return "https://www.google.com/search?q=" + encodeURIComponent(t)
}

async function fetchWithRedirects(startUrl, clientHeaders = {}, maxRedirects = 15) {
  let url = startUrl
  for (let i = 0; i < maxRedirects; i++) {
    const agent = url.startsWith('https') ? httpsAgent : httpAgent
    
    const forwardHeaders = {
      "User-Agent": clientHeaders["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": clientHeaders["accept"] || "*/*",
      "Accept-Language": clientHeaders["accept-language"] || "en-US,en;q=0.9",
      "Accept-Encoding": clientHeaders["accept-encoding"] || "gzip, deflate, br",
      "Referer": clientHeaders["referer"],
      "Origin": clientHeaders["origin"],
      "Range": clientHeaders["range"],
    }
    
    Object.keys(forwardHeaders).forEach(key => {
      if (!forwardHeaders[key]) delete forwardHeaders[key]
    })

    const r = await fetch(url, {
      redirect: "manual",
      agent,
      headers: forwardHeaders
    });

    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location")
      if (!loc) return { url, res: r }
      url = new URL(loc, url).toString()
      continue
    }
    return { url, res: r }
  }
  throw new Error("Too many redirects")
}

app.get("/search", async (req, res) => {
  const raw = req.query.q || ""
  const normalized = normalizeInput(raw)
  if (!normalized) return res.status(400).send("Missing ?q=")
  if (!isAllowedUrl(normalized)) return res.status(403).send("Only discord.com and google.com allowed")

  const cached = resourceCache.get(normalized)
  if (cached) {
    res.set("Content-Type", cached.contentType)
    res.set("X-Cache", "HIT")
    return res.send(cached.content)
  }

  try {
    const { url, res: remote } = await fetchWithRedirects(normalized)
    const contentType = remote.headers.get("content-type") || ""

    if (contentType.includes("text/css") || contentType.includes("application/css")) {
      const css = await remote.text()
      const rewrittenCss = rewriteCssUrls(css, url, (cssUrl) => {
        try {
          if (cssUrl.startsWith("data:") || cssUrl.startsWith("#")) return cssUrl
          const absolute = new URL(cssUrl, url).toString()
          return "/search?q=" + encodeURIComponent(absolute)
        } catch (e) {
          return cssUrl
        }
      })
      resourceCache.set(normalized, { contentType: "text/css", content: rewrittenCss })
      res.set("Content-Type", "text/css")
      res.set("X-Cache", "MISS")
      return res.send(rewrittenCss)
    }

    if (!contentType.includes("text/html")) {
      const buffer = await remote.buffer()
      resourceCache.set(normalized, { contentType, content: buffer })
      res.set("Content-Type", contentType)
      res.set("X-Cache", "MISS")
      return res.send(buffer)
    }

    const html = await remote.text()
    const $ = cheerio.load(html)

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href")
      if (!href || href.startsWith("data:") || href.startsWith("javascript:")) return
      const absolute = new URL(href, url).toString()
      $(el).attr("href", "/search?q=" + encodeURIComponent(absolute))
    })

    $("form[action]").each((_, el) => {
      const action = $(el).attr("action")
      if (!action) return
      const absolute = new URL(action, url).toString()
      $(el).attr("action", "/search?q=" + encodeURIComponent(absolute))
    })

    $("img[src], img[srcset]").each((_, el) => {
      const src = $(el).attr("src")
      if (src && !src.startsWith("data:")) {
        const absolute = new URL(src, url).toString()
        $(el).attr("src", "/search?q=" + encodeURIComponent(absolute))
      }
      const srcset = $(el).attr("srcset")
      if (srcset) {
        const rewritten = srcset.split(',').map(part => {
          const [urlPart, ...rest] = part.trim().split(/\s+/)
          if (urlPart && !urlPart.startsWith("data:")) {
            const absolute = new URL(urlPart, url).toString()
            return "/search?q=" + encodeURIComponent(absolute) + (rest.length ? ' ' + rest.join(' ') : '')
          }
          return part
        }).join(', ')
        $(el).attr("srcset", rewritten)
      }
    })

    $("script[src]").each((_, el) => {
      const src = $(el).attr("src")
      if (!src || src.startsWith("data:") || src.startsWith("javascript:")) return
      const absolute = new URL(src, url).toString()
      $(el).attr("src", "/search?q=" + encodeURIComponent(absolute))
    })

    $("link[href]").each((_, el) => {
      const href = $(el).attr("href")
      if (!href || href.startsWith("data:") || href.startsWith("javascript:")) return
      const absolute = new URL(href, url).toString()
      $(el).attr("href", "/search?q=" + encodeURIComponent(absolute))
    })

    $("source[src], video[src], audio[src], track[src]").each((_, el) => {
      const src = $(el).attr("src")
      if (!src || src.startsWith("data:")) return
      const absolute = new URL(src, url).toString()
      $(el).attr("src", "/search?q=" + encodeURIComponent(absolute))
    })

    $("iframe[src]").each((_, el) => {
      const src = $(el).attr("src")
      if (!src || src.startsWith("data:") || src.startsWith("javascript:")) return
      const absolute = new URL(src, url).toString()
      $(el).attr("src", "/search?q=" + encodeURIComponent(absolute))
    })

    const proxyScript = `
      <script>
        (function() {
          const proxyUrl = (url) => {
            try {
              const absolute = new URL(url, window.location.href.replace('/search?q=', '').split('?q=')[1] ? decodeURIComponent(window.location.href.split('?q=')[1].split('&')[0]) : window.location.href);
              return '/search?q=' + encodeURIComponent(absolute.toString());
            } catch (e) {
              return url;
            }
          };

          const originalFetch = window.fetch;
          window.fetch = function(resource, init) {
            if (typeof resource === 'string') {
              resource = proxyUrl(resource);
            } else if (resource instanceof Request) {
              resource = new Request(proxyUrl(resource.url), resource);
            }
            return originalFetch.call(this, resource, init);
          };

          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            return originalOpen.call(this, method, proxyUrl(url), ...rest);
          };
        })();
      </script>
    `

    $("head").prepend(proxyScript)

    const finalHtml = $.html()
    resourceCache.set(normalized, { contentType: "text/html", content: finalHtml })
    res.set("Content-Type", "text/html")
    res.set("X-Cache", "MISS")
    res.send(finalHtml)
  } catch (err) {
    console.error(err)
    res.status(500).send("Fetch failed: " + err.message)
  }
})

app.get("/cache-stats", (req, res) => {
  res.json({
    size: resourceCache.cache.size,
    maxSize: resourceCache.maxSize,
    ttl: resourceCache.ttl
  })
})

app.get("/", (req, res) => {
  res.send(`<form action="/search" method="get">
    <input name="q" placeholder="https://discord.com/login or google.com">
    <button>Go</button>
  </form>
  <p>Cache stats: <a href="/cache-stats" target="_blank">View</a></p>`)
})

app.listen(PORT, HOST, () => console.log("Proxy active on", HOST + ":" + PORT))
