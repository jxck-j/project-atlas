// Minimal ZIP reader — just enough to pull one named entry's bytes out of a
// small, well-formed archive (this project's only use case:
// scripts/buildCurrentStatus.mjs's UCDP/PRIO Armed Conflict Dataset
// download, a single-CSV zip). Not a general-purpose unzip library — no
// zip64, no encryption, no streaming, no directory listing beyond what's
// needed to find one entry by name.
//
// Reads via the End Of Central Directory record (not by scanning local file
// headers) specifically so it's correct even if a producer sets the
// data-descriptor bit (local header sizes zeroed, real sizes stored after
// the compressed data) — the central directory's sizes/offsets are always
// authoritative regardless of that bit.
import zlib from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50

function findEndOfCentralDirectory(buf) {
  // The EOCD is the last thing in the file, but may be followed by a
  // variable-length comment field, so scan backward for its signature
  // rather than assuming a fixed offset from the end.
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  throw new Error('Not a valid zip file (no End Of Central Directory record found)')
}

// Returns the raw bytes of the first entry in `zipBuffer` whose name ends
// with `entryNameSuffix` (e.g. '.csv' when the archive holds exactly one
// CSV alongside nothing else worth matching).
export function readZipEntry(zipBuffer, entryNameSuffix) {
  const eocdOffset = findEndOfCentralDirectory(zipBuffer)
  const entryCount = zipBuffer.readUInt16LE(eocdOffset + 10)
  let centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16)

  for (let i = 0; i < entryCount; i++) {
    if (zipBuffer.readUInt32LE(centralDirOffset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`Malformed central directory entry at offset ${centralDirOffset}`)
    }
    const compressionMethod = zipBuffer.readUInt16LE(centralDirOffset + 10)
    const compressedSize = zipBuffer.readUInt32LE(centralDirOffset + 20)
    const nameLength = zipBuffer.readUInt16LE(centralDirOffset + 28)
    const extraLength = zipBuffer.readUInt16LE(centralDirOffset + 30)
    const commentLength = zipBuffer.readUInt16LE(centralDirOffset + 32)
    const localHeaderOffset = zipBuffer.readUInt32LE(centralDirOffset + 42)
    const name = zipBuffer.toString('utf8', centralDirOffset + 46, centralDirOffset + 46 + nameLength)

    if (name.endsWith(entryNameSuffix)) {
      if (zipBuffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
        throw new Error(`Malformed local file header for "${name}"`)
      }
      const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26)
      const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28)
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize)

      if (compressionMethod === 0) return compressed // stored, no compression
      if (compressionMethod === 8) return zlib.inflateRawSync(compressed) // deflate
      throw new Error(`Unsupported zip compression method ${compressionMethod} for "${name}"`)
    }

    centralDirOffset += 46 + nameLength + extraLength + commentLength
  }

  throw new Error(`No entry ending in "${entryNameSuffix}" found in zip`)
}
