import express from "express"
import fetch from "node-fetch"

const app = express()
const PORT = process.env.PORT || 3000
const blocked = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade", "transfer-encoding", "content-encoding"]

async function proxyRequest(targetUrl, req, res) {
  try {
    const response = await fetch(targetUrl, {
      headers: {
        ...req.headers,
        host: new URL(targetUrl).host,
        origin: new URL(targetUrl).origin,
        referer: new URL(targetUrl).origin + "/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
      },
      redirect: "manual"
    })

    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      const redirectUrl = new URL(response.headers.get("location"), targetUrl).href
      return proxyRequest(redirectUrl, req, res)
    }

    for (const [key, value] of response.headers.entries())
      if (!blocked.includes(key.toLowerCase())) res.setHeader(key, value)

    const data = await response.arrayBuffer()
    res.status(response.status).send(Buffer.from(data))
  } catch (e) {
    res.status(500).send("Proxy Error: " + e.message)
  }
}

app.get("/search", async (req, res) => {
  let target = req.query.q
  if (!target) return res.status(400).send("Missing ?q=")
  if (!/^https?:\/\//i.test(target))
    target = "https://www.google.com/search?q=" + encodeURIComponent(target)
  await proxyRequest(target, req, res)
})

app.listen(PORT, () => console.log("Proxy on " + PORT))
