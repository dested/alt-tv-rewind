// Fetch and unpack an archive.org usenet-alt mbox for a newsgroup into
// data/archives/<newsgroup>.mbox. Idempotent: a present mbox is returned as-is.
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import yauzl from 'yauzl'
import { DATA_DIR } from './lib/context'

function extractMbox(zipPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error(`yauzl: could not open ${zipPath}`))
      let found = false
      zip.on('entry', (entry) => {
        if (!entry.fileName.endsWith('.mbox')) {
          zip.readEntry()
          return
        }
        found = true
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('yauzl: no read stream'))
          const ws = createWriteStream(outPath)
          stream.on('error', reject)
          ws.on('error', reject)
          ws.on('finish', () => {
            zip.close()
            resolve()
          })
          stream.pipe(ws)
        })
      })
      zip.on('end', () => {
        if (!found) reject(new Error(`no .mbox entry inside ${zipPath}`))
      })
      zip.readEntry()
    })
  })
}

export async function downloadArchive(newsgroup: string): Promise<string> {
  const path = join(DATA_DIR, 'archives', `${newsgroup}.mbox`)
  if (existsSync(path)) {
    console.log(`[download] ${newsgroup}: already present at ${path}`)
    return path
  }
  mkdirSync(dirname(path), { recursive: true })

  const url = `https://archive.org/download/usenet-alt/${newsgroup}.mbox.zip`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed ${res.status} ${res.statusText}: ${url}`)

  const zipPath = `${path}.zip`
  const bytes = await Bun.write(zipPath, res)
  console.log(`[download] ${newsgroup}: fetched ${(bytes / 1e6).toFixed(1)} MB`)

  await extractMbox(zipPath, path)
  unlinkSync(zipPath)
  console.log(`[download] ${newsgroup}: extracted → ${path}`)
  return path
}
