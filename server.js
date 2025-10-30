const express = require("express")
const fetch = require("node-fetch")
const cheerio = require("cheerio")

const app = express()
const PORT = process.env.PORT || 3000

function isGoogleUrl(url) {
  return true
}

async function fetchWithRedirects(startUrl, maxRedirects = 10) {
  const chain = []
  let url = startUrl
  for (let i = 0; i < maxRedirects; i++) {
    chain.push(url)
    const r = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "EducationalProxy/1.0" }
    })
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location")
      if (!loc) {
        return { chain, final: { url, status: r.status, headers: r.headers, body: await r.text() } }
      }
      let next
      try {
        next = new URL(loc, url).toString()
      } catch {
        return { chain, final: { url, status: r.status, headers: r.headers, body: await r.text() } }
      }
      if (!isGoogleUrl(next)) {
        chain.push(next)
        return { chain, final: { url: next, status: r.status, headers: r.headers, body: null, stoppedAtNonGoogle: true } }
      }
      url = next
      continue
    } else {
      const contentType = r.headers.get("content-type") || ""
      if (contentType.includes("text/html")) {
        const body = await r.text()
        return { chain, final: { url, status: r.status, headers: r.headers, body, contentType } }
      } else {
        const buffer = await r.buffer()
        return { chain, final: { url, status: r.status, headers: r.headers, body: buffer, contentType } }
      }
    }
  }
  return { chain, final: { url, status: 0, headers: null, body: null, error: "redirect_limit" } }
}

app.get("/", (req, res) => {
  res.send(`
    <form action="/search" method="get">
      <input name="q" placeholder="https://www.google.com/search?q=test" style="width:60%">
      <button>Fetch</button>
    </form>
    <p>Only google.com URLs are allowed and followed. Redirect chain will be shown at top.</p>
  `)
})

app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim()
  if (!q) return res.status(400).send("Missing ?q=")
  if (!isGoogleUrl(q)) return res.status(403).send("Only google.com URLs allowed")

  try {
    const { chain, final } = await fetchWithRedirects(q, 15)

    if (final.error) {
      return res.status(500).send("Redirect limit reached or fetch error")
    }

    if (final.stoppedAtNonGoogle) {
      return res.status(200).send(
        `<p>Stopped following redirect because it goes off-google:</p>
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
        if (isGoogleUrl(resolved)) {
          $(el).attr("href", "/search?q=" + encodeURIComponent(resolved))
        } else {
          $(el).attr("target", "_blank")
        }
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

app.listen(PORT, () => console.log("Google-only proxy listening on port", PORT))
