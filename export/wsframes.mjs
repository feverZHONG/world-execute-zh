// Minimal receive-only WebSocket endpoint for raw video frames (no dependencies).
// The page sends one binary message per frame and waits for our "ok" before sending the
// next one, which gives natural back-pressure all the way from ffmpeg to the renderer.
// (Measured on this machine: ~7x faster than fetch(POST) for 33 MB 4K frames.)
import crypto from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const ACK = Buffer.from([0x81, 0x02, 0x6f, 0x6b]);          // unmasked text frame "ok"

/** XOR-unmask dst[from, to) in place; `phase` = mask index of byte `from`. Bulk part runs 4 bytes at a time. */
function unmask(dst, from, to, mask, phase) {
  let p = from;
  while (p < to && (p & 3)) { dst[p] ^= mask[(phase + p - from) & 3]; p++; }
  const ph = (phase + p - from) & 3;
  const word = (mask[ph] | (mask[(ph + 1) & 3] << 8) | (mask[(ph + 2) & 3] << 16) | (mask[(ph + 3) & 3] << 24)) >>> 0;
  const n = (to - p) >> 2, u32 = new Uint32Array(dst.buffer, dst.byteOffset + p, n);
  for (let i = 0; i < n; i++) u32[i] ^= word;
  for (let q = p + n * 4; q < to; q++) dst[q] ^= mask[(phase + q - from) & 3];
}

/**
 * @param frameBytes  exact size of every message (width * height * 4), or 0 = variable size (packed frames:
 *                    png/jpeg), where every message is a whole image and the size changes from frame to frame
 * @param onFrame     async (Uint8Array) => void; the buffer is reused after the promise resolves
 */
export function frameSocketHandler({ frameBytes, onFrame, onError }) {
  return (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);

    const raw = frameBytes > 0;
    const frame = raw ? new Uint8Array(new ArrayBuffer(frameBytes)) : null;   // 4-byte aligned message buffer
    const parts = [];                  // packed mode only: the pieces of the message being received
    const MAX = 64 << 20;              // packed mode guard: no image may be larger than this
    let msgOff = 0;                    // bytes of the current message received so far
    let head = Buffer.alloc(0);        // partial WS frame header
    let frag = null;                   // current WS frame: { left, mask, start, fin, opcode }

    const fail = (e) => { socket.destroy(); onError?.(e); };

    async function onData(d) {
      while (d.length) {
        if (!frag) {                   // ---- parse a frame header (may arrive split across chunks)
          head = head.length ? Buffer.concat([head, d]) : d;
          if (head.length < 2) return;
          const len7 = head[1] & 0x7f, ext = len7 === 126 ? 2 : len7 === 127 ? 8 : 0;
          if (head.length < 2 + ext + 4) return;
          const len = ext === 0 ? len7 : ext === 2 ? head.readUInt16BE(2) : Number(head.readBigUInt64BE(2));
          frag = { left: len, fin: !!(head[0] & 0x80), opcode: head[0] & 0x0f, start: msgOff,
            mask: Uint8Array.from(head.subarray(2 + ext, 6 + ext)) };
          d = head.subarray(6 + ext); head = Buffer.alloc(0);
          if (frag.opcode === 8) { socket.end(); return; }                    // close
          if (frag.opcode > 2) return fail(new Error('unexpected ws opcode ' + frag.opcode));
          if (raw ? msgOff + len > frameBytes : msgOff + len > MAX) return fail(new Error('frame larger than expected'));
        }
        const take = Math.min(frag.left, d.length);
        if (raw) frame.set(d.subarray(0, take), msgOff);
        else {
          // Every WS frame carries its own mask key, so a message split into several frames must be unmasked per
          // frame: copy this piece out at once, then unmask it with the mask of the frame it came from.
          const piece = Buffer.from(d.subarray(0, take));
          unmask(piece, 0, take, frag.mask, msgOff - frag.start);
          parts.push(piece);
        }
        msgOff += take; frag.left -= take; d = d.subarray(take);
        if (frag.left > 0) return;
        const fin = frag.fin, mask = frag.mask, start = frag.start; frag = null;
        if (!fin) continue;                                                   // more fragments follow
        let msg;
        if (raw) {
          unmask(frame, start, msgOff, mask, 0);
          if (msgOff !== frameBytes) return fail(new Error(`bad frame size ${msgOff}, expected ${frameBytes}`));
          msg = frame;
        } else {
          msg = Buffer.concat(parts);
          parts.length = 0;
        }
        msgOff = 0;
        socket.pause();
        try { await onFrame(msg); } catch (e) { return fail(e); }
        socket.resume();
        socket.write(ACK);
      }
    }
    // serialise chunks: onData awaits ffmpeg, so chain them to keep ordering
    let chain = Promise.resolve();
    socket.on('data', (d) => { chain = chain.then(() => onData(d)); });
    socket.on('error', () => {});
  };
}
