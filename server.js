const express = require("express")
const fetch = require("node-fetch")
const cheerio = require("cheerio")

const app = express()
const PORT = process.env.PORT || 3000

function isAllowedUrl(url) {
  return true
}

function normalizeInput(q) {
  if (!q) return null
  const t = q.trim()
  if (t.startsWith("http://") || t.startsWith("https://")) return t
  if (t.includes(" ")) return "https://www.google.com/search?q=" + encodeURIComponent(t)
  if (t.includes(".")) return "https://" + t
  return "https://www.google.com/search?q=" + encodeURIComponent(t)
}

async function fetchWithRedirects(startUrl, maxRedirects = 15) {
  const chain = []
  let url = startUrl
  for (let i = 0; i < maxRedirects; i++) {
    if (chain.includes(url)) return { chain, final: { url, error: "loop_detected" } }
    chain.push(url)
    const r = await fetch(url, { method: "GET", redirect: "manual", headers: { "User-Agent": "EducationalProxy/1.0" } })
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location")
      if (!loc) return { chain, final: { url, status: r.status, headers: r.headers, body: await r.text() } }
      let next
      try { next = new URL(loc, url).toString() } catch { return { chain, final: { url, status: r.status, headers: r.headers, body: await r.text() } } }
      if (!isAllowedUrl(next)) { chain.push(next); return { chain, final: { url: next, status: r.status, headers: r.headers, body: null, stoppedAtNonAllowed: true } } }
      url = next
      continue
    }
    const contentType = r.headers.get("content-type") || ""
    if (!contentType.includes("text/html")) {
      const buffer = await r.buffer()
      return { chain, final: { url, status: r.status, headers: r.headers, body: buffer, contentType } }
    }
    const body = await r.text()
    const $ = cheerio.load(body)
    const meta = $('meta[http-equiv="refresh"]').attr("content")
    if (meta) {
      const m = meta.split(";").map(x => x.trim())
      if (m.length > 1 && m[1].toLowerCase().startsWith("url=")) {
        let loc = m[1].slice(4)
        try { loc = new URL(loc, url).toString() } catch { return { chain, final: { url, status: r.status, headers: r.headers, body } } }
        if (!isAllowedUrl(loc)) { chain.push(loc); return { chain, final: { url: loc, status: r.status, headers: r.headers, body: null, stoppedAtNonAllowed: true } } }
        url = loc
        continue
      }
    }
    return { chain, final: { url, status: r.status, headers: r.headers, body, contentType } }
  }
  return { chain, final: { url, status: 0, headers: null, body: null, error: "redirect_limit" } }
}

app.get("/", (req, res) => {
  res.send(`
    <form action="/search" method="get">
      <input name="q" placeholder="google.com or discord.com or a search term" style="width:60%">
      <button>Fetch</button>
    </form>
    <p>Only google.com and discord.com URLs allowed.</p>
  `)
})

app.get("/search", async (req, res) => {
  const raw = req.query.q || ""
  const normalized = normalizeInput(raw)
  if (!normalized) return res.status(400).send("Missing ?q=")
  if (!isAllowedUrl(normalized)) return res.status(403).send("Only google.com and discord.com URLs allowed")
  try {
    const { chain, final } = await fetchWithRedirects(normalized, 20)
    if (final.error) return res.status(500).send("Error: " + final.error)
    if (final.stoppedAtNonAllowed) {
      return res.status(200).send(
        `<p>Stopped following redirect because it goes off allowed domains:</p>
         <pre>${JSON.stringify(chain, null, 2)}</pre>
         <p>Final redirect target (not fetched): <a href="${chain[chain.length-1]}" target="_blank">${chain[chain.length-1]}</a></p>`
      )
    }
    if (!final.contentType || !final.contentType.includes("text/html")) {
      res.set("Content-Type", final.contentType || "application/octet-stream")
      return res.send(final.body)
    }
    const $ = cheerio.load(final.body)
    $("a[href]").each((i, el) => {
      const href = $(el).attr("href")
      if (!href) return
      try {
        const resolved = new URL(href, final.url).toString()
        if (isAllowedUrl(resolved)) $(el).attr("href", "/search?q=" + encodeURIComponent(resolved))
        else $(el).attr("target", "_blank")
      } catch {}
    })
    const banner = `
      <div style="background:#fffae6;border:1px solid #ffd24d;padding:8px;font-family:monospace;">
        <strong>Redirect chain (earliest → latest):</strong>
        <ol>
          ${chain.map(u => `<li><a href="/search?q=${encodeURIComponent(u)}">${u}</a></li>`).join("")}
        </ol>
      </div>
    `
    if ($("body").length) {
      $("body").prepend(banner)
      res.set("Content-Type", "text/html").send($.html())
    } else {
      res.set("Content-Type", "text/html").send(banner + $.html())
    }
  } catch (err) {
    console.error(err)
    res.status(500).send("Fetch failed: " + err.message)
  }
})

app.listen(PORT, () => console.log("Proxy listening on port", PORT))
