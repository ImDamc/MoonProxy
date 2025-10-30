import express from "express"
import fetch from "node-fetch"
import Redis from "ioredis"

const app = express()
const redis = new Redis(process.env.REDIS_URL || "")
const PORT = process.env.PORT || 10000
const BING_KEY = process.env.BING_KEY

app.get("/", (req, res) => res.send("Proxy active"))

app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim()
  if (!q) return res.status(400).json({ error: "missing q" })

  const cacheKey = "s:" + q
  const cached = await redis.get(cacheKey)
  if (cached) return res.type("application/json").send(cached)

  const url = "https://api.bing.microsoft.com/v7.0/search?q=" + encodeURIComponent(q)
  try {
    const r = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": BING_KEY } })
    const json = await r.json()
    const out = JSON.stringify({
      provider: "bing",
      results: json.webPages?.value?.map(x => ({
        title: x.name,
        url: x.url,
        snippet: x.snippet
      })) || []
    })
    await redis.set(cacheKey, out, "EX", 60)
    res.type("application/json").send(out)
  } catch {
    res.status(500).json({ error: "internal" })
  }
})

app.listen(PORT, () => console.log("Running on", PORT))
