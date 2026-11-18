import { inflateRawSync } from 'node:zlib'

// Reads one named top-level file out of a ZIP archive held in memory. The speech.cpp release archives are small
// (6–30 MB) and flat, and the app needs only the `speech` executable from them, so this avoids depending on
// `unzip`, `ditto` or `tar` being present on the learner's machine.

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

let crcTable = null
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new Error('The archive is not a ZIP file.')
}

export function listZipEntries(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buffer.length < 22) throw new Error('The archive is not a ZIP file.')
  const eocd = findEndOfCentralDirectory(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  const size = buffer.readUInt32LE(eocd + 12)
  let offset = buffer.readUInt32LE(eocd + 16)
  if (offset + size > eocd) throw new Error('The ZIP central directory is out of bounds.')
  const entries = []
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error('The ZIP central directory is corrupt.')
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const externalAttributes = buffer.readUInt32LE(offset + 38)
    const unixMode = (externalAttributes >>> 16) & 0xffff
    entries.push({
      name: buffer.toString('utf8', offset + 46, offset + 46 + nameLength),
      flags: buffer.readUInt16LE(offset + 8),
      method: buffer.readUInt16LE(offset + 10),
      crc32: buffer.readUInt32LE(offset + 16),
      compressedSize: buffer.readUInt32LE(offset + 20),
      size: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
      isSymlink: (unixMode & 0o170000) === 0o120000,
      isDirectory: (unixMode & 0o170000) === 0o040000 || buffer.toString('utf8', offset + 46 + nameLength - 1, offset + 46 + nameLength) === '/'
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export function isSafeZipEntryName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== '.' && name !== '..'
}

export function readZipEntry(input, name, { maxBytes = 128 * 1024 * 1024 } = {}) {
  if (!isSafeZipEntryName(name)) throw new Error('Only plain top-level file names can be read from the archive.')
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const entries = listZipEntries(buffer)
  const matches = entries.filter((entry) => entry.name === name)
  if (matches.length !== 1) throw new Error(`The archive does not contain exactly one ${name}.`)
  const entry = matches[0]
  if (entry.isSymlink || entry.isDirectory) throw new Error(`${name} in the archive is not a regular file.`)
  if (entry.flags & 0x1) throw new Error(`${name} in the archive is encrypted.`)
  if (entry.size > maxBytes) throw new Error(`${name} in the archive is larger than expected.`)
  const local = entry.localHeaderOffset
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) throw new Error('The ZIP local header is corrupt.')
  const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
  const end = start + entry.compressedSize
  if (end > buffer.length) throw new Error('The ZIP entry is truncated.')
  const compressed = buffer.subarray(start, end)
  let data
  if (entry.method === 0) data = Buffer.from(compressed)
  else if (entry.method === 8) data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) })
  else throw new Error(`${name} uses an unsupported ZIP compression method (${entry.method}).`)
  if (data.length !== entry.size) throw new Error(`${name} has an unexpected size after extraction.`)
  if (crc32(data) !== entry.crc32) throw new Error(`${name} failed its ZIP CRC-32 check.`)
  return data
}

export { crc32 as zipCrc32 }
