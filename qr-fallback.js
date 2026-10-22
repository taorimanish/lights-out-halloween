// =============================================================
// Minimal, self-contained QR Code generator (fallback).
// Used only if the CDN qrcode.js fails to load, so the printable
// poster still works fully offline.
//
// Based on the public-domain QR encoding approach; implements
// byte-mode encoding with automatic version selection and
// error-correction level M. Renders to a <canvas>.
// Exposes: window.LO_QR_FALLBACK(containerEl, text, sizePx)
// =============================================================

(function () {
  "use strict";

  // --- Galois field tables for Reed-Solomon ---
  var EXP = new Array(512), LOG = new Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11d;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function rsGenPoly(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var np = [];
      np[0] = poly[0];
      for (var j = 1; j <= poly.length; j++) {
        np[j] = (poly[j] || 0) ^ gmul(poly[j - 1], EXP[i]);
      }
      poly = np;
    }
    return poly;
  }
  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = data.slice().concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) {
        for (var j = 0; j < gen.length; j++) {
          res[i + j] ^= gmul(gen[j], coef);
        }
      }
    }
    return res.slice(data.length);
  }

  // Capacity (data codewords) + EC per block, for EC level M, versions 1..10.
  // [ dataCodewords, ecPerBlock, numBlocks1, blockLen1, numBlocks2, blockLen2 ]
  var VERSIONS = {
    1:  [16, 10, 1, 16, 0, 0],
    2:  [28, 16, 1, 28, 0, 0],
    3:  [44, 26, 1, 44, 0, 0],
    4:  [64, 18, 2, 32, 0, 0],
    5:  [86, 24, 2, 43, 0, 0],
    6:  [108, 16, 4, 27, 0, 0],
    7:  [124, 18, 4, 31, 0, 0],
    8:  [154, 22, 2, 38, 2, 39],
    9:  [182, 22, 3, 36, 2, 37],
    10: [216, 26, 4, 43, 1, 44],
  };

  function chooseVersion(len) {
    // bytes -> needed data codewords incl. mode(4b)+count(8/16b)+terminator
    for (var v = 1; v <= 10; v++) {
      var cap = VERSIONS[v][0];
      var countBits = v >= 10 ? 16 : 8;
      var needBits = 4 + countBits + len * 8;
      if (Math.ceil(needBits / 8) <= cap) return v;
    }
    throw new Error("Data too long for fallback QR (max ~ version 10). Shorten the URL.");
  }

  function encodeData(text, version) {
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) { bytes.push(192 | (c >> 6), 128 | (c & 63)); }
      else { bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
    }
    var countBits = version >= 10 ? 16 : 8;
    var bits = [];
    function push(val, n) { for (var k = n - 1; k >= 0; k--) bits.push((val >> k) & 1); }
    push(0x4, 4);               // byte mode
    push(bytes.length, countBits);
    for (i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var cap = VERSIONS[version][0];
    var totalBits = cap * 8;
    // terminator
    var term = Math.min(4, totalBits - bits.length);
    for (i = 0; i < term; i++) bits.push(0);
    // pad to byte
    while (bits.length % 8 !== 0) bits.push(0);
    // pad bytes
    var pad = [0xec, 0x11], pi = 0;
    var dataCW = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dataCW.push(b);
    }
    while (dataCW.length < cap) { dataCW.push(pad[pi % 2]); pi++; }
    return dataCW;
  }

  function interleave(dataCW, version) {
    var spec = VERSIONS[version];
    var ecLen = spec[1];
    var blocks = [];
    var idx = 0;
    var groups = [[spec[2], spec[3]], [spec[4], spec[5]]];
    for (var g = 0; g < groups.length; g++) {
      for (var b = 0; b < groups[g][0]; b++) {
        var dlen = groups[g][1];
        var d = dataCW.slice(idx, idx + dlen); idx += dlen;
        var ec = rsEncode(d, ecLen);
        blocks.push({ d: d, ec: ec });
      }
    }
    var maxD = 0, result = [];
    for (var i = 0; i < blocks.length; i++) maxD = Math.max(maxD, blocks[i].d.length);
    for (i = 0; i < maxD; i++) for (var k = 0; k < blocks.length; k++) if (i < blocks[k].d.length) result.push(blocks[k].d[i]);
    for (i = 0; i < ecLen; i++) for (k = 0; k < blocks.length; k++) result.push(blocks[k].ec[i]);
    return result;
  }

  // --- Matrix construction ---
  function buildMatrix(version, codewords) {
    var size = 17 + version * 4;
    var m = []; var reserved = [];
    for (var r = 0; r < size; r++) { m.push(new Array(size).fill(null)); reserved.push(new Array(size).fill(false)); }

    function placeFinder(row, col) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m[rr][cc] = on ? 1 : 0; reserved[rr][cc] = true;
      }
    }
    placeFinder(0, 0); placeFinder(0, size - 7); placeFinder(size - 7, 0);

    // timing patterns
    for (var i = 8; i < size - 8; i++) {
      m[6][i] = (i % 2 === 0) ? 1 : 0; reserved[6][i] = true;
      m[i][6] = (i % 2 === 0) ? 1 : 0; reserved[i][6] = true;
    }
    // dark module
    m[size - 8][8] = 1; reserved[size - 8][8] = true;

    // alignment pattern (versions >=2 have one center for v2..6; we handle generic single center for small versions)
    if (version >= 2) {
      var centers = alignCenters(version);
      for (var a = 0; a < centers.length; a++) for (var bb = 0; bb < centers.length; bb++) {
        var cr = centers[a], cc2 = centers[bb];
        if (reserved[cr] && reserved[cr][cc2]) continue;
        // skip if overlaps finder
        if ((cr <= 7 && cc2 <= 7) || (cr <= 7 && cc2 >= size - 8) || (cr >= size - 8 && cc2 <= 7)) continue;
        for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
          var on2 = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          m[cr + dr][cc2 + dc] = on2 ? 1 : 0; reserved[cr + dr][cc2 + dc] = true;
        }
      }
    }

    // reserve format info areas
    for (i = 0; i < 9; i++) { if (!reserved[8][i]) reserved[8][i] = true; if (!reserved[i][8]) reserved[i][8] = true; }
    for (i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }

    // place data with mask 0
    var bitIdx = 0; var dirUp = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var rowStep = 0; rowStep < size; rowStep++) {
        var row = dirUp ? (size - 1 - rowStep) : rowStep;
        for (var cPair = 0; cPair < 2; cPair++) {
          var cc3 = col - cPair;
          if (reserved[row][cc3]) continue;
          var bit = 0;
          if (bitIdx < codewords.length * 8) {
            bit = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
          }
          bitIdx++;
          // mask 0: (row+col)%2==0 -> invert
          if ((row + cc3) % 2 === 0) bit ^= 1;
          m[row][cc3] = bit;
        }
      }
      dirUp = !dirUp;
    }

    // format info for EC level M (bits 00) + mask 0 -> precomputed string
    var fmt = formatBits(0b00, 0); // M, mask 0
    placeFormat(m, size, fmt);

    return m;
  }

  function alignCenters(version) {
    // single center coordinate list for versions 2..10
    var table = { 2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50] };
    return table[version] || [6];
  }

  function formatBits(ecLevel, mask) {
    var data = (ecLevel << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) ? 0x537 : 0);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var arr = [];
    for (i = 14; i >= 0; i--) arr.push((bits >> i) & 1);
    return arr;
  }

  function placeFormat(m, size, fmt) {
    // around top-left + split copies
    var coords1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    for (var i = 0; i < 15; i++) { var c = coords1[i]; m[c[0]][c[1]] = fmt[i]; }
    for (i = 0; i < 7; i++) m[size - 1 - i][8] = fmt[i];
    for (i = 0; i < 8; i++) m[8][size - 8 + i] = fmt[7 + i];
  }

  // --- Public render ---
  window.LO_QR_FALLBACK = function (container, text, sizePx) {
    try {
      var version = chooseVersion(text.length);
      var data = encodeData(text, version);
      var cw = interleave(data, version);
      var m = buildMatrix(version, cw);
      var n = m.length;
      var quiet = 4;
      var total = n + quiet * 2;
      var scale = Math.max(1, Math.floor(sizePx / total));
      var canvas = document.createElement("canvas");
      canvas.width = canvas.height = total * scale;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#141414";
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        if (m[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
      container.innerHTML = "";
      container.appendChild(canvas);
    } catch (e) {
      container.textContent = "QR fallback error: " + e.message;
    }
  };
})();
