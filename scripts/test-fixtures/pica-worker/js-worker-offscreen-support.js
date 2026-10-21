(function workerPayload(self) {
							if (typeof createImageBitmap === "undefined") {
								self.postMessage(false);
								return;
							}
							Promise.resolve().then(function() {
								var canvas = new OffscreenCanvas(10, 10);
								canvas.getContext("2d").rect(0, 0, 1, 1);
								return createImageBitmap(canvas, 0, 0, 1, 1);
							}).then(function() {
								return self.postMessage(true);
							}, function() {
								return self.postMessage(false);
							});
						})(self);