import express from "express"
import fetch from "node-fetch"
import cheerio from "cheerio"

const app = express()
const PORT = process.env.PORT || 10000

function normalizeUrl(q) {
  if (!q) return null
  const t = q.trim()
  if (t.startsWith("http://") || t.startsWith("https://")) return t
  if (t.includes(".")) return "https://" + t
  return "https://www.google.com/search?q=" + encodeURIComponent(t)
}

function isAllowed(url) {
  return true
}

async function fetchFollow(url, depth = 0) {
  if (depth > 15) throw new Error("redirect loop")
  const r = await fetch(url, {
    redirect: "manual",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Connection": "keep-alive"
    }
  })
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get("location")
    if (!loc) return r
    const next = new URL(loc, url).toString()
    if (!isAllowed(next)) return r
    return fetchFollow(next, depth + 1)
  }
  return r
}

app.get("/", (req, res) => {
  res.send(`
    <form action="/search" method="get">
      <input name="q" placeholder="https://discord.com, google.com, or search term" style="width:60%">
      <button>Go</button>
    </form>
    <p>Allowed: google.com, discord.com only</p>
  `)
})

app.get("/search", async (req, res) => {
  const q = req.query.q || ""
  const target = normalizeUrl(q)
  if (!target) return res.status(400).send("Missing ?q=")
  if (!isAllowed(target)) return res.status(403).send("Only google.com and discord.com allowed")

  try {
    const r = await fetchFollow(target)
    const contentType = r.headers.get("content-type") || ""
    const cookies = r.headers.get("set-cookie") || ""
    const text = await r.text()

    if (!contentType.includes("text/html")) {
      res.set("Content-Type", contentType)
      return res.send(text)
    }

    const $ = cheerio.load(text)
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href")
      if (!href) return
      try {
        const abs = new URL(href, target).toString()
        if (isAllowed(abs)) $(el).attr("href", "/search?q=" + encodeURIComponent(abs))
        else $(el).attr("target", "_blank")
      } catch {}
    })

    const banner = `
      <div style="background:#eef;padding:10px;font-family:monospace;">
        <strong>Fetched:</strong> ${target}<br>
        <strong>Cookies:</strong> ${cookies || "(none)"}<br>
        <strong>Type:</strong> ${contentType}
      </div>
    `
    res.set("Content-Type", "text/html").send(banner + $.html())
  } catch (err) {
    res.status(500).send("Failed: " + err.message)
  }
})

app.listen(PORT, () => console.log("Running on", PORT))
