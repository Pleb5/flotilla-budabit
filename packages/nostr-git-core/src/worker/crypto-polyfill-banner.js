// Crypto polyfill for worker context - MUST run before any other code
(function initWorkerCryptoPolyfill() {
  const globalScope = typeof self !== 'undefined' ? self : globalThis;
  const isInsecure = typeof globalScope.isSecureContext !== 'undefined' && !globalScope.isSecureContext;
  const needsPolyfill = !globalScope.crypto?.subtle?.digest || isInsecure;
  if (needsPolyfill) {
    console.warn('[Worker] Installing crypto.subtle polyfill (insecure context or missing crypto.subtle)');
    function sha256(data) {
      const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
      const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
      const rotr = (n, x) => (x >>> n) | (x << (32 - n));
      const ch = (x, y, z) => (x & y) ^ (~x & z);
      const maj = (x, y, z) => (x & y) ^ (x & z) ^ (y & z);
      const sigma0 = (x) => rotr(2, x) ^ rotr(13, x) ^ rotr(22, x);
      const sigma1 = (x) => rotr(6, x) ^ rotr(11, x) ^ rotr(25, x);
      const gamma0 = (x) => rotr(7, x) ^ rotr(18, x) ^ (x >>> 3);
      const gamma1 = (x) => rotr(17, x) ^ rotr(19, x) ^ (x >>> 10);
      const bitLen = data.length * 8;
      const padLen = (data.length % 64 < 56 ? 56 : 120) - (data.length % 64);
      const padded = new Uint8Array(data.length + padLen + 8);
      padded.set(data);
      padded[data.length] = 0x80;
      const view = new DataView(padded.buffer);
      view.setUint32(padded.length - 4, bitLen, false);
      const h = new Uint32Array(H);
      const w = new Uint32Array(64);
      for (let i = 0; i < padded.length; i += 64) {
        for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
        for (let j = 16; j < 64; j++) w[j] = (gamma1(w[j - 2]) + w[j - 7] + gamma0(w[j - 15]) + w[j - 16]) >>> 0;
        let [a, b, c, d, e, f, g, hh] = h;
        for (let j = 0; j < 64; j++) {
          const t1 = (hh + sigma1(e) + ch(e, f, g) + K[j] + w[j]) >>> 0;
          const t2 = (sigma0(a) + maj(a, b, c)) >>> 0;
          hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+hh)>>>0;
      }
      const result = new Uint8Array(32);
      const resultView = new DataView(result.buffer);
      for (let i = 0; i < 8; i++) resultView.setUint32(i * 4, h[i], false);
      return result;
    }
    function sha1(data) {
      const H = new Uint32Array([0x67452301,0xEFCDAB89,0x98BADCFE,0x10325476,0xC3D2E1F0]);
      const rotl = (n, x) => (x << n) | (x >>> (32 - n));
      const bitLen = data.length * 8;
      const padLen = (data.length % 64 < 56 ? 56 : 120) - (data.length % 64);
      const padded = new Uint8Array(data.length + padLen + 8);
      padded.set(data);
      padded[data.length] = 0x80;
      const view = new DataView(padded.buffer);
      view.setUint32(padded.length - 4, bitLen, false);
      const h = new Uint32Array(H);
      const w = new Uint32Array(80);
      for (let i = 0; i < padded.length; i += 64) {
        for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
        for (let j = 16; j < 80; j++) w[j] = rotl(1, w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16]);
        let [a, b, c, d, e] = h;
        for (let j = 0; j < 80; j++) {
          let f, k;
          if (j < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
          else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
          else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
          else { f = b ^ c ^ d; k = 0xCA62C1D6; }
          const temp = (rotl(5, a) + f + e + k + w[j]) >>> 0;
          e = d; d = c; c = rotl(30, b); b = a; a = temp;
        }
        h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;
      }
      const result = new Uint8Array(20);
      const resultView = new DataView(result.buffer);
      for (let i = 0; i < 5; i++) resultView.setUint32(i * 4, h[i], false);
      return result;
    }
    if (!globalScope.crypto) globalScope.crypto = {};
    globalScope.crypto.subtle = {
      digest: async (algorithm, data) => {
        const algo = algorithm.toLowerCase().replace('-', '');
        const input = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        let result;
        if (algo === 'sha256') result = sha256(input);
        else if (algo === 'sha1') result = sha1(input);
        else throw new Error('Unsupported algorithm: ' + algorithm);
        const output = new ArrayBuffer(result.length);
        new Uint8Array(output).set(result);
        return output;
      }
    };
    console.log('[Worker] crypto.subtle polyfill installed successfully');
  }
})();
