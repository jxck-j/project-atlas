// GET a URL through the system curl instead of Node's fetch. Exists for ONE reason: apnews.com sits behind Cloudflare, which answers 403
// to Node's HTTP client and 200 to curl for the identical request (same User-Agent, same headers — a transport-level fingerprint, not
// anything we send). It is opt-in per channel (`"transport": "curl"` in wireSources.json) and used only after J confirmed AP's
// permission for this fetch (2026-09-26); it is not a general way to get past a block, and no channel uses it by default. The request
// still identifies itself honestly as this project's bot.
import { execFile } from 'node:child_process'

const UA = 'Mozilla/5.0 (compatible; ProjectAtlasNewsBot/1.0)'
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'

function curlOnce(url) {
  return new Promise((resolve, reject) => {
    // -w appends the status after the body so a non-200 is an error, not an HTML block page parsed as if it were the sitemap.
    execFile(CURL, ['-sS', '-L', '--compressed', '--max-time', '30', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      if (err) return reject(new Error(`curl failed: ${err.message.split('\n')[0]}`))
      const cut = stdout.lastIndexOf('\n')
      const status = Number(stdout.slice(cut + 1))
      if (status !== 200) return reject(new Error(`${status} via curl`))
      resolve(stdout.slice(0, cut))
    })
  })
}

export async function fetchTextViaCurl(url, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await curlOnce(url)
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)))
    }
  }
  throw lastErr
}
