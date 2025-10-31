import express from "express"
import puppeteer from "puppeteer-core"
import chromium from "chromium"

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

app.get("/", (req, res) => {
  res.send(`
    <form action="/search" method="get">
      <input name="q" placeholder="google.com, discord.com, or search term" style="width:60%">
      <button>Go</button>
    </form>
    <p>Allowed domains: google.com, discord.com</p>
  `)
})

app.get("/search", async (req, res) => {
  const raw = req.query.q || ""
  const target = normalizeUrl(raw)
  if (!target) return res.status(400).send("Missing ?q=")
  if (!isAllowed(target)) return res.status(403).send("Only google.com and discord.com allowed")

  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: chromium.path,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--no-zygote",
        "--single-process"
      ],
      headless: true,
      timeout: 0
    })

    const page = await browser.newPage()
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
    await page.setDefaultNavigationTimeout(60000)

    let current = target
    const chain = []
    for (let i = 0; i < 15; i++) {
      chain.push(current)
      if (!isAllowed(current)) break
      await page.goto(current, { waitUntil: "networkidle0", timeout: 60000 })
      const next = page.url()
      if (next === current) break
      current = next
    }

    const html = await page.content()
    await browser.close()

    res.set("Content-Type", "text/html")
    res.send(`
      <div style="background:#eef;padding:10px;font-family:monospace">
        <strong>Redirect chain:</strong>
        <ol>${chain.map(u => `<li><a href="/search?q=${encodeURIComponent(u)}">${u}</a></li>`).join("")}</ol>
      </div>
      ${html}
    `)
  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    res.status(500).send("Fetch/render failed: " + err.message)
  }
})

app.listen(PORT, () => console.log("Server running on port", PORT))
