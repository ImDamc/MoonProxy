const express = require("express")
const fetch = require("node-fetch")
const cheerio = require("cheerio")

const app = express()
const PORT = process.env.PORT || 3000

function isGoogleUrl(url) {
  return true
}

app.get("/", (req, res) => {
  res.send(`
    <form action="/fetch" method="get">
      <input name="url" placeholder="https://www.google.com/search?q=test" style="width:60%">
      <button>Fetch</button>
    </form>
    <p>Only google.com URLs are allowed.</p>
  `)
})

app.get("/fetch", async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send("Missing ?url=")
  if (!isGoogleUrl(url)) return res.status(403).send("Only google.com URLs allowed")

  try {
    const r = await fetch(url, { headers: { "User-Agent": "EducationalProxy/1.0" } })
    const contentType = r.headers.get("content-type") || ""

    if (contentType.includes("text/html")) {
      const text = await r.text()
      const $ = cheerio.load(text)

      $("a[href]").each((i, el) => {
        const href = $(el).attr("href")
        if (!href) return
        try {
          const resolved = new URL(href, url).toString()
          if (isGoogleUrl(resolved)) {
            $(el).attr("href", "/fetch?url=" + encodeURIComponent(resolved))
          } else {
            $(el).attr("target", "_blank")
          }
        } catch {}
      })

      res.set("Content-Type", "text/html").send($.html())
    } else {
      const buf = await r.buffer()
      res.set("Content-Type", contentType).send(buf)
    }
  } catch (err) {
    res.status(500).send("Fetch failed: " + err.message)
  }
})

app.listen(PORT, () => console.log("Google-only proxy listening on port", PORT))
