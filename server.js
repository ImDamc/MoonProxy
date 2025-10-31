const express = require("express")
const fetch = require("node-fetch")
const cheerio = require("cheerio")
const puppeteer = require("puppeteer")

const app = express()
const PORT = process.env.PORT || 3000

function isAllowed(u) {
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

async function fetchWithRedirects(startUrl, maxRedirects = 20) {
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
      if (!isAllowed(next)) { chain.push(next); return { chain, final: { url: next, status: r.status, headers: r.headers, body: null, stoppedAtNonAllowed: true } } }
      url = next
      continue
    }
    const contentType = r.headers.get("content-type") || ""
    if (!contentType.includes("text/html")) {
      const buffer = await r.buffer()
      return { chain, final: { url, status: r.status, headers: r.headers.raw(), body: buffer, contentType } }
    }
    const body = await r.text()
    const $ = cheerio.load(body)
    const meta = $('meta[http-equiv="refresh"]').attr("content")
    if (meta) {
      const m = meta.split(";").map(x => x.trim())
      if (m.length > 1 && m[1].toLowerCase().startsWith("url=")) {
        let loc = m[1].slice(4)
        try { loc = new URL(loc, url).toString() } catch { return { chain, final: { url, status: r.status, headers: r.headers, body } } }
        if (!isAllowed(loc)) { chain.push(loc); return { chain, final: { url: loc, status: r.status, headers: r.headers, body: null, stoppedAtNonAllowed: true } } }
        url = loc
        continue
      }
    }
    return { chain, final: { url, status: r.status, headers: r.headers.raw ? r.headers.raw() : r.headers, body, contentType } }
  }
  return { chain, final: { url, status: 0, headers: null, body: null, error: "redirect_limit" } }
}

app.get("/", (req, res) => {
  res.send('<form action="/search" method="get"><input name="q" style="width:60%"><button>Fetch</button></form><p>Allowed: google.com, discord.com</p>')
})

app.get("/search", async (req, res) => {
  const raw = req.query.q || ""
  const normalized = normalizeInput(raw)
  if (!normalized) return res.status(400).send("Missing ?q=")
  if (!isAllowed(normalized)) return res.status(403).send("Only google.com and discord.com allowed")
  let browser
  try {
    const { chain, final } = await fetchWithRedirects(normalized, 25)
    if (final.error) return res.status(500).send("Error: " + final.error)
    if (final.stoppedAtNonAllowed) {
      return res.status(200).send(`<p>Stopped following redirect because it goes off allowed domains:</p><pre>${JSON.stringify(chain, null, 2)}</pre><p>Final redirect target (not fetched): <a href="${chain[chain.length-1]}" target="_blank">${chain[chain.length-1]}</a></p>`)
    }
    if (!final.contentType || !final.contentType.includes("text/html")) {
      const headers = final.headers || {}
      Object.entries(headers).forEach(([k, v]) => { try { res.set(k, v) } catch {} })
      return res.send(final.body)
    }
    browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] })
    const page = await browser.newPage()
    await page.setUserAgent(req.get("user-agent") || "Mozilla/5.0")
    await page.setViewport({ width: 1200, height: 800 })
    await page.goto(final.url, { waitUntil: "networkidle2", timeout: 45000 })
    const cookies = await page.cookies()
    let content = await page.content()
    await browser.close()
    const $ = cheerio.load(content)
    $("a[href]").each((i, el) => {
      const href = $(el).attr("href")
      if (!href) return
      try {
        const resolved = new URL(href, final.url).toString()
        if (isAllowed(resolved)) $(el).attr("href", "/search?q=" + encodeURIComponent(resolved))
        else $(el).attr("target", "_blank")
      } catch {}
    })
    const banner = `<div style="background:#fffae6;border:1px solid #ffd24d;padding:8px;font-family:monospace"><strong>Redirect chain (earliest → latest):</strong><ol>${chain.map(u=>`<li><a href="/search?q=${encodeURIComponent(u)}">${u}</a></li>`).join("")}</ol><strong>Cookies from renderer:</strong><pre>${JSON.stringify(cookies,null,2)}</pre></div>`
    if ($("body").length) {
      res.set("Content-Type", "text/html").send($.html())
    } else {
      res.set("Content-Type", "text/html").send($.html())
    }
  } catch (err) {
    if (browser) try { await browser.close() } catch {}
    console.error(err)
    res.status(500).send("Fetch/render failed: " + err.message)
  }
})

app.listen(PORT, () => console.log("listening on", PORT))
