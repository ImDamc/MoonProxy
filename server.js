import express from "express"
import fetch from "node-fetch"

const app = express()
const PORT = process.env.PORT || 3000

const disallowedHopHeaders = [
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
]

async function proxyRequest(targetUrl, req, res) {
  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        ...req.headers,
        "host": new URL(targetUrl).host,
        "origin": new URL(targetUrl).origin,
        "referer": new URL(targetUrl).origin + "/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "manual",
    })

    if (
      upstream.status >= 300 &&
      upstream.status < 400 &&
      upstream.headers.get("location")
    ) {
      const redirectUrl = upstream.headers.get("location")
      const absoluteRedirect = new URL(redirectUrl, targetUrl).href
      console.log("Redirecting to:", absoluteRedirect)
      return proxyRequest(absoluteRedirect, req, res)
    }

    for (const [key, value] of upstream.headers.entries()) {
      if (!disallowedHopHeaders.includes(key.toLowerCase()))
        res.setHeader(key, value)
    }

    const buffer = await upstream.arrayBuffer()
    res.status(upstream.status).send(Buffer.from(buffer))
  } catch (err) {
    console.error("Proxy error:", err)
    res.status(500).send("Proxy error occurred.")
  }
}

app.get("/search", async (req, res) => {
  const targetUrl = req.query.q
  if (!targetUrl) return res.status(400).send("Missing ?q parameter")
  if (!/^https?:\/\//i.test(targetUrl))
    return res.status(400).send("Invalid URL")
  await proxyRequest(targetUrl, req, res)
})

app.get("/proxy/*", async (req, res) => {
  const path = req.params[0]
  const targetUrl = path.startsWith("http") ? path : "https://" + path
  if (!/^https?:\/\//i.test(targetUrl))
    return res.status(400).send("Invalid target URL")
  await proxyRequest(targetUrl, req, res)
})

app.listen(PORT, () =>
  console.log(`✅ Proxy running on port ${PORT}`)
)
