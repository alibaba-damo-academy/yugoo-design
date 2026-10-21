(function r(e, n, t) {
				function o(i, f) {
					if (!n[i]) {
						if (!e[i]) {
							var c = "function" == typeof __require && __require;
							if (!f && c) return c(i, !0);
							if (u) return u(i, !0);
							var a = /* @__PURE__ */ new Error("Cannot find module '" + i + "'");
							throw a.code = "MODULE_NOT_FOUND", a;
						}
						var p = n[i] = { exports: {} };
						e[i][0].call(p.exports, function(r) {
							var n = e[i][1][r];
							return o(n || r);
						}, p, p.exports, r, e, n, t);
					}
					return n[i].exports;
				}
				for (var u = "function" == typeof __require && __require, i = 0; i < t.length; i++) o(t[i]);
				return o;
			})({"1":[function(_dereq_, module$1, exports$1) {
				"use strict";
				var inherits = _dereq_("inherits");
				var Multimath = _dereq_("multimath");
				var mm_unsharp_mask = _dereq_("./mm_unsharp_mask");
				var mm_resize = _dereq_("./mm_resize");
				function MathLib(requested_features) {
					var __requested_features = requested_features || [];
					var features = {
						js: __requested_features.indexOf("js") >= 0,
						wasm: __requested_features.indexOf("wasm") >= 0
					};
					Multimath.call(this, features);
					this.features = {
						js: features.js,
						wasm: features.wasm && this.has_wasm()
					};
					this.use(mm_unsharp_mask);
					this.use(mm_resize);
				}
				inherits(MathLib, Multimath);
				MathLib.prototype.resizeAndUnsharp = function resizeAndUnsharp(options, cache) {
					var result = this.resize(options, cache);
					if (options.unsharpAmount) this.unsharp_mask(result, options.toWidth, options.toHeight, options.unsharpAmount, options.unsharpRadius, options.unsharpThreshold);
					return result;
				};
				module$1.exports = MathLib;
			},{"./mm_resize":4,"./mm_unsharp_mask":9,"inherits":19,"multimath":20}],"2":[function(_dereq_, module$2, exports$2) {
				"use strict";
				function clampTo8(i) {
					return i < 0 ? 0 : i > 255 ? 255 : i;
				}
				function convolveHorizontally(src, dest, srcW, srcH, destW, filters) {
					var r, g, b, a;
					var filterPtr, filterShift, filterSize;
					var srcPtr, srcY, destX, filterVal;
					var srcOffset = 0, destOffset = 0;
					for (srcY = 0; srcY < srcH; srcY++) {
						filterPtr = 0;
						for (destX = 0; destX < destW; destX++) {
							filterShift = filters[filterPtr++];
							filterSize = filters[filterPtr++];
							srcPtr = srcOffset + filterShift * 4 | 0;
							r = g = b = a = 0;
							for (; filterSize > 0; filterSize--) {
								filterVal = filters[filterPtr++];
								a = a + filterVal * src[srcPtr + 3] | 0;
								b = b + filterVal * src[srcPtr + 2] | 0;
								g = g + filterVal * src[srcPtr + 1] | 0;
								r = r + filterVal * src[srcPtr] | 0;
								srcPtr = srcPtr + 4 | 0;
							}
							dest[destOffset + 3] = clampTo8(a + 8192 >> 14);
							dest[destOffset + 2] = clampTo8(b + 8192 >> 14);
							dest[destOffset + 1] = clampTo8(g + 8192 >> 14);
							dest[destOffset] = clampTo8(r + 8192 >> 14);
							destOffset = destOffset + srcH * 4 | 0;
						}
						destOffset = (srcY + 1) * 4 | 0;
						srcOffset = (srcY + 1) * srcW * 4 | 0;
					}
				}
				function convolveVertically(src, dest, srcW, srcH, destW, filters) {
					var r, g, b, a;
					var filterPtr, filterShift, filterSize;
					var srcPtr, srcY, destX, filterVal;
					var srcOffset = 0, destOffset = 0;
					for (srcY = 0; srcY < srcH; srcY++) {
						filterPtr = 0;
						for (destX = 0; destX < destW; destX++) {
							filterShift = filters[filterPtr++];
							filterSize = filters[filterPtr++];
							srcPtr = srcOffset + filterShift * 4 | 0;
							r = g = b = a = 0;
							for (; filterSize > 0; filterSize--) {
								filterVal = filters[filterPtr++];
								a = a + filterVal * src[srcPtr + 3] | 0;
								b = b + filterVal * src[srcPtr + 2] | 0;
								g = g + filterVal * src[srcPtr + 1] | 0;
								r = r + filterVal * src[srcPtr] | 0;
								srcPtr = srcPtr + 4 | 0;
							}
							dest[destOffset + 3] = clampTo8(a + 8192 >> 14);
							dest[destOffset + 2] = clampTo8(b + 8192 >> 14);
							dest[destOffset + 1] = clampTo8(g + 8192 >> 14);
							dest[destOffset] = clampTo8(r + 8192 >> 14);
							destOffset = destOffset + srcH * 4 | 0;
						}
						destOffset = (srcY + 1) * 4 | 0;
						srcOffset = (srcY + 1) * srcW * 4 | 0;
					}
				}
				module$2.exports = {
					convolveHorizontally,
					convolveVertically
				};
			},{}],"3":[function(_dereq_, module$3, exports$3) {
				"use strict";
				module$3.exports = "AGFzbQEAAAAADAZkeWxpbmsAAAAAAAEXA2AAAGAGf39/f39/AGAHf39/f39/fwACDwEDZW52Bm1lbW9yeQIAAAMEAwABAgYGAX8AQQALB1cFEV9fd2FzbV9jYWxsX2N0b3JzAAAIY29udm9sdmUAAQpjb252b2x2ZUhWAAIMX19kc29faGFuZGxlAwAYX193YXNtX2FwcGx5X2RhdGFfcmVsb2NzAAAK7AMDAwABC8YDAQ9/AkAgA0UNACAERQ0AA0AgDCENQQAhE0EAIQcDQCAHQQJqIQYCfyAHQQF0IAVqIgcuAQIiFEUEQEGAwAAhCEGAwAAhCUGAwAAhCkGAwAAhCyAGDAELIBIgBy4BAGohCEEAIQsgFCEHQQAhDiAGIQlBACEPQQAhEANAIAUgCUEBdGouAQAiESAAIAhBAnRqKAIAIgpBGHZsIBBqIRAgCkH/AXEgEWwgC2ohCyAKQRB2Qf8BcSARbCAPaiEPIApBCHZB/wFxIBFsIA5qIQ4gCEEBaiEIIAlBAWohCSAHQQFrIgcNAAsgC0GAQGshCCAOQYBAayEJIA9BgEBrIQogEEGAQGshCyAGIBRqCyEHIAEgDUECdGogCUEOdSIGQf8BIAZB/wFIGyIGQQAgBkEAShtBCHRBgP4DcSAKQQ51IgZB/wEgBkH/AUgbIgZBACAGQQBKG0EQdEGAgPwHcSALQQ51IgZB/wEgBkH/AUgbIgZBACAGQQBKG0EYdHJyIAhBDnUiBkH/ASAGQf8BSBsiBkEAIAZBAEobcjYCACADIA1qIQ0gE0EBaiITIARHDQALIAxBAWoiDCACbCESIAMgDEcNAAsLCx4AQQAgAiADIAQgBSAAEAEgAkEAIAQgBSAGIAEQAQs=";
			},{}],"4":[function(_dereq_, module$4, exports$4) {
				"use strict";
				module$4.exports = {
					name: "resize",
					fn: _dereq_("./resize"),
					wasm_fn: _dereq_("./resize_wasm"),
					wasm_src: _dereq_("./convolve_wasm_base64")
				};
			},{"./convolve_wasm_base64":3,"./resize":5,"./resize_wasm":8}],"5":[function(_dereq_, module$5, exports$5) {
				"use strict";
				var createFilters = _dereq_("./resize_filter_gen");
				var convolveHorizontally = _dereq_("./convolve").convolveHorizontally;
				var convolveVertically = _dereq_("./convolve").convolveVertically;
				function resetAlpha(dst, width, height) {
					var ptr = 3, len = width * height * 4 | 0;
					while (ptr < len) {
						dst[ptr] = 255;
						ptr = ptr + 4 | 0;
					}
				}
				module$5.exports = function resize(options) {
					var src = options.src;
					var srcW = options.width;
					var srcH = options.height;
					var destW = options.toWidth;
					var destH = options.toHeight;
					var scaleX = options.scaleX || options.toWidth / options.width;
					var scaleY = options.scaleY || options.toHeight / options.height;
					var offsetX = options.offsetX || 0;
					var offsetY = options.offsetY || 0;
					var dest = options.dest || new Uint8Array(destW * destH * 4);
					var quality = typeof options.quality === "undefined" ? 3 : options.quality;
					var alpha = options.alpha || false;
					var filtersX = createFilters(quality, srcW, destW, scaleX, offsetX), filtersY = createFilters(quality, srcH, destH, scaleY, offsetY);
					var tmp = new Uint8Array(destW * srcH * 4);
					convolveHorizontally(src, tmp, srcW, srcH, destW, filtersX);
					convolveVertically(tmp, dest, srcH, destW, destH, filtersY);
					if (!alpha) resetAlpha(dest, destW, destH);
					return dest;
				};
			},{"./convolve":2,"./resize_filter_gen":6}],"6":[function(_dereq_, module$6, exports$6) {
				"use strict";
				var FILTER_INFO = _dereq_("./resize_filter_info");
				var FIXED_FRAC_BITS = 14;
				function toFixedPoint(num) {
					return Math.round(num * ((1 << FIXED_FRAC_BITS) - 1));
				}
				module$6.exports = function resizeFilterGen(quality, srcSize, destSize, scale, offset) {
					var filterFunction = FILTER_INFO[quality].filter;
					var scaleInverted = 1 / scale;
					var scaleClamped = Math.min(1, scale);
					var srcWindow = FILTER_INFO[quality].win / scaleClamped;
					var destPixel, srcPixel, srcFirst, srcLast, filterElementSize, floatFilter, fxpFilter, total, pxl, idx, floatVal, filterTotal, filterVal;
					var leftNotEmpty, rightNotEmpty, filterShift, filterSize;
					var maxFilterElementSize = Math.floor((srcWindow + 1) * 2);
					var packedFilter = new Int16Array((maxFilterElementSize + 2) * destSize);
					var packedFilterPtr = 0;
					var slowCopy = !packedFilter.subarray || !packedFilter.set;
					for (destPixel = 0; destPixel < destSize; destPixel++) {
						srcPixel = (destPixel + .5) * scaleInverted + offset;
						srcFirst = Math.max(0, Math.floor(srcPixel - srcWindow));
						srcLast = Math.min(srcSize - 1, Math.ceil(srcPixel + srcWindow));
						filterElementSize = srcLast - srcFirst + 1;
						floatFilter = new Float32Array(filterElementSize);
						fxpFilter = new Int16Array(filterElementSize);
						total = 0;
						for (pxl = srcFirst, idx = 0; pxl <= srcLast; pxl++, idx++) {
							floatVal = filterFunction((pxl + .5 - srcPixel) * scaleClamped);
							total += floatVal;
							floatFilter[idx] = floatVal;
						}
						filterTotal = 0;
						for (idx = 0; idx < floatFilter.length; idx++) {
							filterVal = floatFilter[idx] / total;
							filterTotal += filterVal;
							fxpFilter[idx] = toFixedPoint(filterVal);
						}
						fxpFilter[destSize >> 1] += toFixedPoint(1 - filterTotal);
						leftNotEmpty = 0;
						while (leftNotEmpty < fxpFilter.length && fxpFilter[leftNotEmpty] === 0) leftNotEmpty++;
						if (leftNotEmpty < fxpFilter.length) {
							rightNotEmpty = fxpFilter.length - 1;
							while (rightNotEmpty > 0 && fxpFilter[rightNotEmpty] === 0) rightNotEmpty--;
							filterShift = srcFirst + leftNotEmpty;
							filterSize = rightNotEmpty - leftNotEmpty + 1;
							packedFilter[packedFilterPtr++] = filterShift;
							packedFilter[packedFilterPtr++] = filterSize;
							if (!slowCopy) {
								packedFilter.set(fxpFilter.subarray(leftNotEmpty, rightNotEmpty + 1), packedFilterPtr);
								packedFilterPtr += filterSize;
							} else for (idx = leftNotEmpty; idx <= rightNotEmpty; idx++) packedFilter[packedFilterPtr++] = fxpFilter[idx];
						} else {
							packedFilter[packedFilterPtr++] = 0;
							packedFilter[packedFilterPtr++] = 0;
						}
					}
					return packedFilter;
				};
			},{"./resize_filter_info":7}],"7":[function(_dereq_, module$7, exports$7) {
				"use strict";
				module$7.exports = [
					{
						win: .5,
						filter: function filter(x) {
							return x >= -.5 && x < .5 ? 1 : 0;
						}
					},
					{
						win: 1,
						filter: function filter(x) {
							if (x <= -1 || x >= 1) return 0;
							if (x > -1.1920929e-7 && x < 1.1920929e-7) return 1;
							var xpi = x * Math.PI;
							return Math.sin(xpi) / xpi * (.54 + .46 * Math.cos(xpi / 1));
						}
					},
					{
						win: 2,
						filter: function filter(x) {
							if (x <= -2 || x >= 2) return 0;
							if (x > -1.1920929e-7 && x < 1.1920929e-7) return 1;
							var xpi = x * Math.PI;
							return Math.sin(xpi) / xpi * Math.sin(xpi / 2) / (xpi / 2);
						}
					},
					{
						win: 3,
						filter: function filter(x) {
							if (x <= -3 || x >= 3) return 0;
							if (x > -1.1920929e-7 && x < 1.1920929e-7) return 1;
							var xpi = x * Math.PI;
							return Math.sin(xpi) / xpi * Math.sin(xpi / 3) / (xpi / 3);
						}
					}
				];
			},{}],"8":[function(_dereq_, module$8, exports$8) {
				"use strict";
				var createFilters = _dereq_("./resize_filter_gen");
				function resetAlpha(dst, width, height) {
					var ptr = 3, len = width * height * 4 | 0;
					while (ptr < len) {
						dst[ptr] = 255;
						ptr = ptr + 4 | 0;
					}
				}
				function asUint8Array(src) {
					return new Uint8Array(src.buffer, 0, src.byteLength);
				}
				var IS_LE = true;
				try {
					IS_LE = new Uint32Array(new Uint8Array([
						1,
						0,
						0,
						0
					]).buffer)[0] === 1;
				} catch (__) {}
				function copyInt16asLE(src, target, target_offset) {
					if (IS_LE) {
						target.set(asUint8Array(src), target_offset);
						return;
					}
					for (var ptr = target_offset, i = 0; i < src.length; i++) {
						var data = src[i];
						target[ptr++] = data & 255;
						target[ptr++] = data >> 8 & 255;
					}
				}
				module$8.exports = function resize_wasm(options) {
					var src = options.src;
					var srcW = options.width;
					var srcH = options.height;
					var destW = options.toWidth;
					var destH = options.toHeight;
					var scaleX = options.scaleX || options.toWidth / options.width;
					var scaleY = options.scaleY || options.toHeight / options.height;
					var offsetX = options.offsetX || 0;
					var offsetY = options.offsetY || 0;
					var dest = options.dest || new Uint8Array(destW * destH * 4);
					var quality = typeof options.quality === "undefined" ? 3 : options.quality;
					var alpha = options.alpha || false;
					var filtersX = createFilters(quality, srcW, destW, scaleX, offsetX), filtersY = createFilters(quality, srcH, destH, scaleY, offsetY);
					var tmp_offset = this.__align(0 + Math.max(src.byteLength, dest.byteLength));
					var filtersX_offset = this.__align(tmp_offset + srcH * destW * 4);
					var filtersY_offset = this.__align(filtersX_offset + filtersX.byteLength);
					var alloc_bytes = filtersY_offset + filtersY.byteLength;
					var instance = this.__instance("resize", alloc_bytes);
					var mem = new Uint8Array(this.__memory.buffer);
					var mem32 = new Uint32Array(this.__memory.buffer);
					var src32 = new Uint32Array(src.buffer);
					mem32.set(src32);
					copyInt16asLE(filtersX, mem, filtersX_offset);
					copyInt16asLE(filtersY, mem, filtersY_offset);
					(instance.exports.convolveHV || instance.exports._convolveHV)(filtersX_offset, filtersY_offset, tmp_offset, srcW, srcH, destW, destH);
					new Uint32Array(dest.buffer).set(new Uint32Array(this.__memory.buffer, 0, destH * destW));
					if (!alpha) resetAlpha(dest, destW, destH);
					return dest;
				};
			},{"./resize_filter_gen":6}],"9":[function(_dereq_, module$9, exports$9) {
				"use strict";
				module$9.exports = {
					name: "unsharp_mask",
					fn: _dereq_("./unsharp_mask"),
					wasm_fn: _dereq_("./unsharp_mask_wasm"),
					wasm_src: _dereq_("./unsharp_mask_wasm_base64")
				};
			},{"./unsharp_mask":10,"./unsharp_mask_wasm":11,"./unsharp_mask_wasm_base64":12}],"10":[function(_dereq_, module$10, exports$10) {
				"use strict";
				var glur_mono16 = _dereq_("glur/mono16");
				function hsv_v16(img, width, height) {
					var size = width * height;
					var out = new Uint16Array(size);
					var r, g, b, max;
					for (var i = 0; i < size; i++) {
						r = img[4 * i];
						g = img[4 * i + 1];
						b = img[4 * i + 2];
						max = r >= g && r >= b ? r : g >= b && g >= r ? g : b;
						out[i] = max << 8;
					}
					return out;
				}
				module$10.exports = function unsharp(img, width, height, amount, radius, threshold) {
					var v1, v2, vmul;
					var diff, iTimes4;
					if (amount === 0 || radius < .5) return;
					if (radius > 2) radius = 2;
					var brightness = hsv_v16(img, width, height);
					var blured = new Uint16Array(brightness);
					glur_mono16(blured, width, height, radius);
					var amountFp = amount / 100 * 4096 + .5 | 0;
					var thresholdFp = threshold << 8;
					var size = width * height;
					for (var i = 0; i < size; i++) {
						v1 = brightness[i];
						diff = v1 - blured[i];
						if (Math.abs(diff) >= thresholdFp) {
							v2 = v1 + (amountFp * diff + 2048 >> 12);
							v2 = v2 > 65280 ? 65280 : v2;
							v2 = v2 < 0 ? 0 : v2;
							v1 = v1 !== 0 ? v1 : 1;
							vmul = (v2 << 12) / v1 | 0;
							iTimes4 = i * 4;
							img[iTimes4] = img[iTimes4] * vmul + 2048 >> 12;
							img[iTimes4 + 1] = img[iTimes4 + 1] * vmul + 2048 >> 12;
							img[iTimes4 + 2] = img[iTimes4 + 2] * vmul + 2048 >> 12;
						}
					}
				};
			},{"glur/mono16":18}],"11":[function(_dereq_, module$11, exports$11) {
				"use strict";
				module$11.exports = function unsharp(img, width, height, amount, radius, threshold) {
					if (amount === 0 || radius < .5) return;
					if (radius > 2) radius = 2;
					var pixels = width * height;
					var img_bytes_cnt = pixels * 4;
					var hsv_bytes_cnt = pixels * 2;
					var blur_bytes_cnt = pixels * 2;
					var blur_line_byte_cnt = Math.max(width, height) * 4;
					var blur_coeffs_byte_cnt = 32;
					var img_offset = 0;
					var hsv_offset = img_bytes_cnt;
					var blur_offset = hsv_offset + hsv_bytes_cnt;
					var blur_tmp_offset = blur_offset + blur_bytes_cnt;
					var blur_line_offset = blur_tmp_offset + blur_bytes_cnt;
					var blur_coeffs_offset = blur_line_offset + blur_line_byte_cnt;
					var instance = this.__instance("unsharp_mask", img_bytes_cnt + hsv_bytes_cnt + blur_bytes_cnt * 2 + blur_line_byte_cnt + blur_coeffs_byte_cnt, { exp: Math.exp });
					var img32 = new Uint32Array(img.buffer);
					new Uint32Array(this.__memory.buffer).set(img32);
					var fn = instance.exports.hsv_v16 || instance.exports._hsv_v16;
					fn(img_offset, hsv_offset, width, height);
					fn = instance.exports.blurMono16 || instance.exports._blurMono16;
					fn(hsv_offset, blur_offset, blur_tmp_offset, blur_line_offset, blur_coeffs_offset, width, height, radius);
					fn = instance.exports.unsharp || instance.exports._unsharp;
					fn(img_offset, img_offset, hsv_offset, blur_offset, width, height, amount, threshold);
					img32.set(new Uint32Array(this.__memory.buffer, 0, pixels));
				};
			},{}],"12":[function(_dereq_, module$12, exports$12) {
				"use strict";
				module$12.exports = "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";
			},{}],"17":[function(_dereq_, module$17, exports$17) {
				"use strict";
				module$17.exports = function() {
					var MathLib = _dereq_("./mathlib");
					var mathLib;
					onmessage = function onmessage(ev) {
						var tileOpts = ev.data.opts;
						var returnBitmap = false;
						if (!tileOpts.src && tileOpts.srcBitmap) {
							var canvas = new OffscreenCanvas(tileOpts.width, tileOpts.height);
							var ctx = canvas.getContext("2d", { alpha: Boolean(tileOpts.alpha) });
							ctx.drawImage(tileOpts.srcBitmap, 0, 0);
							tileOpts.src = ctx.getImageData(0, 0, tileOpts.width, tileOpts.height).data;
							canvas.width = canvas.height = 0;
							canvas = null;
							tileOpts.srcBitmap.close();
							tileOpts.srcBitmap = null;
						}
						if (!mathLib) mathLib = new MathLib(ev.data.features);
						var data = mathLib.resizeAndUnsharp(tileOpts);
						if (returnBitmap) {
							var toImageData = new ImageData(new Uint8ClampedArray(data), tileOpts.toWidth, tileOpts.toHeight);
							var _canvas = new OffscreenCanvas(tileOpts.toWidth, tileOpts.toHeight);
							_canvas.getContext("2d", { alpha: Boolean(tileOpts.alpha) }).putImageData(toImageData, 0, 0);
							createImageBitmap(_canvas).then(function(bitmap) {
								postMessage({ bitmap }, [bitmap]);
							});
						} else postMessage({ data }, [data.buffer]);
					};
				};
			},{"./mathlib":1}],"18":[function(_dereq_, module$18, exports$18) {
				var a0, a1, a2, a3, b1, b2, left_corner, right_corner;
				function gaussCoef(sigma) {
					if (sigma < .5) sigma = .5;
					var a = Math.exp(.527076) / sigma, g1 = Math.exp(-a), g2 = Math.exp(-2 * a), k = (1 - g1) * (1 - g1) / (1 + 2 * a * g1 - g2);
					a0 = k;
					a1 = k * (a - 1) * g1;
					a2 = k * (a + 1) * g1;
					a3 = -k * g2;
					b1 = 2 * g1;
					b2 = -g2;
					left_corner = (a0 + a1) / (1 - b1 - b2);
					right_corner = (a2 + a3) / (1 - b1 - b2);
					return new Float32Array([
						a0,
						a1,
						a2,
						a3,
						b1,
						b2,
						left_corner,
						right_corner
					]);
				}
				function convolveMono16(src, out, line, coeff, width, height) {
					var prev_src, curr_src, curr_out, prev_out, prev_prev_out;
					var src_index, out_index, line_index;
					var i, j;
					var coeff_a0, coeff_a1, coeff_b1, coeff_b2;
					for (i = 0; i < height; i++) {
						src_index = i * width;
						out_index = i;
						line_index = 0;
						prev_src = src[src_index];
						prev_prev_out = prev_src * coeff[6];
						prev_out = prev_prev_out;
						coeff_a0 = coeff[0];
						coeff_a1 = coeff[1];
						coeff_b1 = coeff[4];
						coeff_b2 = coeff[5];
						for (j = 0; j < width; j++) {
							curr_src = src[src_index];
							curr_out = curr_src * coeff_a0 + prev_src * coeff_a1 + prev_out * coeff_b1 + prev_prev_out * coeff_b2;
							prev_prev_out = prev_out;
							prev_out = curr_out;
							prev_src = curr_src;
							line[line_index] = prev_out;
							line_index++;
							src_index++;
						}
						src_index--;
						line_index--;
						out_index += height * (width - 1);
						prev_src = src[src_index];
						prev_prev_out = prev_src * coeff[7];
						prev_out = prev_prev_out;
						curr_src = prev_src;
						coeff_a0 = coeff[2];
						coeff_a1 = coeff[3];
						for (j = width - 1; j >= 0; j--) {
							curr_out = curr_src * coeff_a0 + prev_src * coeff_a1 + prev_out * coeff_b1 + prev_prev_out * coeff_b2;
							prev_prev_out = prev_out;
							prev_out = curr_out;
							prev_src = curr_src;
							curr_src = src[src_index];
							out[out_index] = line[line_index] + prev_out;
							src_index--;
							line_index--;
							out_index -= height;
						}
					}
				}
				function blurMono16(src, width, height, radius) {
					if (!radius) return;
					var out = new Uint16Array(src.length), tmp_line = new Float32Array(Math.max(width, height));
					var coeff = gaussCoef(radius);
					convolveMono16(src, out, tmp_line, coeff, width, height, radius);
					convolveMono16(out, src, tmp_line, coeff, height, width, radius);
				}
				module$18.exports = blurMono16;
			},{}],"19":[function(_dereq_, module$19, exports$19) {
				if (typeof Object.create === "function") module$19.exports = function inherits(ctor, superCtor) {
					if (superCtor) {
						ctor.super_ = superCtor;
						ctor.prototype = Object.create(superCtor.prototype, { constructor: {
							value: ctor,
							enumerable: false,
							writable: true,
							configurable: true
						} });
					}
				};
				else module$19.exports = function inherits(ctor, superCtor) {
					if (superCtor) {
						ctor.super_ = superCtor;
						var TempCtor = function() {};
						TempCtor.prototype = superCtor.prototype;
						ctor.prototype = new TempCtor();
						ctor.prototype.constructor = ctor;
					}
				};
			},{}],"20":[function(_dereq_, module$20, exports$20) {
				"use strict";
				var assign = _dereq_("object-assign");
				var base64decode = _dereq_("./lib/base64decode");
				var hasWebAssembly = _dereq_("./lib/wa_detect");
				var DEFAULT_OPTIONS = {
					js: true,
					wasm: true
				};
				function MultiMath(options) {
					if (!(this instanceof MultiMath)) return new MultiMath(options);
					var opts = assign({}, DEFAULT_OPTIONS, options || {});
					this.options = opts;
					this.__cache = {};
					this.__init_promise = null;
					this.__modules = opts.modules || {};
					this.__memory = null;
					this.__wasm = {};
					this.__isLE = new Uint32Array(new Uint8Array([
						1,
						0,
						0,
						0
					]).buffer)[0] === 1;
					if (!this.options.js && !this.options.wasm) throw new Error("mathlib: at least \"js\" or \"wasm\" should be enabled");
				}
				MultiMath.prototype.has_wasm = hasWebAssembly;
				MultiMath.prototype.use = function(module$21) {
					this.__modules[module$21.name] = module$21;
					if (this.options.wasm && this.has_wasm() && module$21.wasm_fn) this[module$21.name] = module$21.wasm_fn;
					else this[module$21.name] = module$21.fn;
					return this;
				};
				MultiMath.prototype.init = function() {
					if (this.__init_promise) return this.__init_promise;
					if (!this.options.js && this.options.wasm && !this.has_wasm()) return Promise.reject(/* @__PURE__ */ new Error("mathlib: only \"wasm\" was enabled, but it's not supported"));
					var self = this;
					this.__init_promise = Promise.all(Object.keys(self.__modules).map(function(name) {
						var module$22 = self.__modules[name];
						if (!self.options.wasm || !self.has_wasm() || !module$22.wasm_fn) return null;
						if (self.__wasm[name]) return null;
						return WebAssembly.compile(self.__base64decode(module$22.wasm_src)).then(function(m) {
							self.__wasm[name] = m;
						});
					})).then(function() {
						return self;
					});
					return this.__init_promise;
				};
				MultiMath.prototype.__base64decode = base64decode;
				MultiMath.prototype.__reallocate = function mem_grow_to(bytes) {
					if (!this.__memory) {
						this.__memory = new WebAssembly.Memory({ initial: Math.ceil(bytes / 65536) });
						return this.__memory;
					}
					var mem_size = this.__memory.buffer.byteLength;
					if (mem_size < bytes) this.__memory.grow(Math.ceil((bytes - mem_size) / 65536));
					return this.__memory;
				};
				MultiMath.prototype.__instance = function instance(name, memsize, env_extra) {
					if (memsize) this.__reallocate(memsize);
					if (!this.__wasm[name]) {
						var module$23 = this.__modules[name];
						this.__wasm[name] = new WebAssembly.Module(this.__base64decode(module$23.wasm_src));
					}
					if (!this.__cache[name]) {
						var env_base = {
							memoryBase: 0,
							memory: this.__memory,
							tableBase: 0,
							table: new WebAssembly.Table({
								initial: 0,
								element: "anyfunc"
							})
						};
						this.__cache[name] = new WebAssembly.Instance(this.__wasm[name], { env: assign(env_base, env_extra || {}) });
					}
					return this.__cache[name];
				};
				MultiMath.prototype.__align = function align(number, base) {
					base = base || 8;
					var reminder = number % base;
					return number + (reminder ? base - reminder : 0);
				};
				module$20.exports = MultiMath;
			},{"./lib/base64decode":21,"./lib/wa_detect":22,"object-assign":23}],"21":[function(_dereq_, module$24, exports$21) {
				"use strict";
				var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
				module$24.exports = function base64decode(str) {
					var input = str.replace(/[\r\n=]/g, ""), max = input.length;
					var out = new Uint8Array(max * 3 >> 2);
					var bits = 0;
					var ptr = 0;
					for (var idx = 0; idx < max; idx++) {
						if (idx % 4 === 0 && idx) {
							out[ptr++] = bits >> 16 & 255;
							out[ptr++] = bits >> 8 & 255;
							out[ptr++] = bits & 255;
						}
						bits = bits << 6 | BASE64_MAP.indexOf(input.charAt(idx));
					}
					var tailbits = max % 4 * 6;
					if (tailbits === 0) {
						out[ptr++] = bits >> 16 & 255;
						out[ptr++] = bits >> 8 & 255;
						out[ptr++] = bits & 255;
					} else if (tailbits === 18) {
						out[ptr++] = bits >> 10 & 255;
						out[ptr++] = bits >> 2 & 255;
					} else if (tailbits === 12) out[ptr++] = bits >> 4 & 255;
					return out;
				};
			},{}],"22":[function(_dereq_, module$25, exports$22) {
				"use strict";
				var wa;
				module$25.exports = function hasWebAssembly() {
					if (typeof wa !== "undefined") return wa;
					wa = false;
					if (typeof WebAssembly === "undefined") return wa;
					try {
						var bin = new Uint8Array([
							0,
							97,
							115,
							109,
							1,
							0,
							0,
							0,
							1,
							6,
							1,
							96,
							1,
							127,
							1,
							127,
							3,
							2,
							1,
							0,
							5,
							3,
							1,
							0,
							1,
							7,
							8,
							1,
							4,
							116,
							101,
							115,
							116,
							0,
							0,
							10,
							16,
							1,
							14,
							0,
							32,
							0,
							65,
							1,
							54,
							2,
							0,
							32,
							0,
							40,
							2,
							0,
							11
						]);
						var module$26 = new WebAssembly.Module(bin);
						if (new WebAssembly.Instance(module$26, {}).exports.test(4) !== 0) wa = true;
						return wa;
					} catch (__) {}
					return wa;
				};
			},{}],"23":[function(_dereq_, module$27, exports$23) {
				/*
				object-assign
				(c) Sindre Sorhus
				@license MIT
				*/
				"use strict";
				var getOwnPropertySymbols = Object.getOwnPropertySymbols;
				var hasOwnProperty = Object.prototype.hasOwnProperty;
				var propIsEnumerable = Object.prototype.propertyIsEnumerable;
				function toObject(val) {
					if (val === null || val === void 0) throw new TypeError("Object.assign cannot be called with null or undefined");
					return Object(val);
				}
				function shouldUseNative() {
					try {
						if (!Object.assign) return false;
						var test1 = /* @__PURE__ */ new String("abc");
						test1[5] = "de";
						if (Object.getOwnPropertyNames(test1)[0] === "5") return false;
						var test2 = {};
						for (var i = 0; i < 10; i++) test2["_" + String.fromCharCode(i)] = i;
						if (Object.getOwnPropertyNames(test2).map(function(n) {
							return test2[n];
						}).join("") !== "0123456789") return false;
						var test3 = {};
						"abcdefghijklmnopqrst".split("").forEach(function(letter) {
							test3[letter] = letter;
						});
						if (Object.keys(Object.assign({}, test3)).join("") !== "abcdefghijklmnopqrst") return false;
						return true;
					} catch (err) {
						return false;
					}
				}
				module$27.exports = shouldUseNative() ? Object.assign : function(target, source) {
					var from;
					var to = toObject(target);
					var symbols;
					for (var s = 1; s < arguments.length; s++) {
						from = Object(arguments[s]);
						for (var key in from) if (hasOwnProperty.call(from, key)) to[key] = from[key];
						if (getOwnPropertySymbols) {
							symbols = getOwnPropertySymbols(from);
							for (var i = 0; i < symbols.length; i++) if (propIsEnumerable.call(from, symbols[i])) to[symbols[i]] = from[symbols[i]];
						}
					}
					return to;
				};
			},{}],"2d7a0464":[function(require,module,exports){var f = require("17");(f.default ? f.default : f)(self);},{"17":"17"}]},{},["2d7a0464"])