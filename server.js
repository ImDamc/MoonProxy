import express from "express"
import fetch from "node-fetch"
import * as cheerio from "cheerio"

const app = express()
const PORT = process.env.PORT || 3000

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

async function fetchWithRedirects(startUrl, maxRedirects = 15) {
  let url = startUrl
  for (let i = 0; i < maxRedirects; i++) {
    const r = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    })
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

  try {
    const { url, res: remote } = await fetchWithRedirects(normalized)
    const contentType = remote.headers.get("content-type") || ""

    if (!contentType.includes("text/html")) {
      res.set("Content-Type", contentType)
      return res.send(await remote.buffer())
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

    $("img[src]").each((_, el) => {
      const src = $(el).attr("src")
      if (!src || src.startsWith("data:")) return
      const absolute = new URL(src, url).toString()
      $(el).attr("src", "/search?q=" + encodeURIComponent(absolute))
    })

    res.set("Content-Type", "text/html")
    res.send($.html())
  } catch (err) {
    console.error(err)
    res.status(500).send("Fetch failed: " + err.message)
  }
})

app.get("/", (req, res) => {
  res.send(`<form action="/search" method="get">
    <input name="q" placeholder="https://discord.com/login or google.com">
    <button>Go</button>
  </form>`)
})

app.listen(PORT, () => console.log("Proxy active on", PORT))
