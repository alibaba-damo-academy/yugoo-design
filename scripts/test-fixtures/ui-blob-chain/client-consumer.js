var _Y = async (e, t) => {
	if (e.type === H.svg) return e;
	let [n, r] = await Promise.all([import("./pica-DGw4b28J.js").then((m) => /* @__PURE__ */ __toESM(m.default, 1)).then((i) => i.default), import("./image-blob-reduce.esm-BvXskEpO.js").then((i) => i.default)]), o = r({ pica: n({ features: ["js", "wasm"] }) });
	if (t.outputType) {
		let { outputType: i } = t;
		o._create_blob = function(a) {
			return this.pica.toBlob(a.out_canvas, i, .8).then((s) => (a.out_blob = s, a));
		};
	}
	if (!Hi$1(e)) throw new Error("Error: unsupported file type", { cause: "UNSUPPORTED" });
	return new File([await o.toBlob(e, {
		max: t.maxWidthOrHeight,
		alpha: !0
	})], e.name, { type: t.outputType || e.type });
};
