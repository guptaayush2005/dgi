/**
 * Book ISBN / QR scanner for camera and image uploads
 */

class QRCodeManager {
  constructor() {
    this.videoStream = null;
    this.scanInterval = null;
  }

  async createBarcodeDetector() {
    if (!("BarcodeDetector" in window)) return null;
    const supportedFormats = await window.BarcodeDetector.getSupportedFormats();
    const formats = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"]
      .filter(format => supportedFormats.includes(format));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  }

  // --- Live Camera Scanner ---
  async startCamera(videoElement, onScanCallback, onErrorCallback) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (onErrorCallback) onErrorCallback("Camera access is not supported by your browser or environment.");
      return;
    }

    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }
      });
      videoElement.srcObject = this.videoStream;
      videoElement.setAttribute("playsinline", true);
      await videoElement.play();

      // Scan loop using canvas
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const barcodeDetector = await this.createBarcodeDetector();
      let scanning = false;

      this.scanInterval = setInterval(async () => {
        if (scanning || videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA) return;
        scanning = true;
        try {
          canvas.width = videoElement.videoWidth;
          canvas.height = videoElement.videoHeight;
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

          if (barcodeDetector) {
            const detections = await barcodeDetector.detect(canvas);
            if (detections.length && detections[0].rawValue) {
              const value = detections[0].rawValue;
              this.stopCamera();
              onScanCallback(value);
              return;
            }
          }

          if (typeof jsQR !== "undefined") {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code?.data) {
              this.stopCamera();
              onScanCallback(code.data);
            }
          }
        } catch (err) {
          console.warn("Book code scan failed:", err);
        } finally {
          scanning = false;
        }
      }, 350);

    } catch (err) {
      console.warn("Camera start warning:", err);
      if (onErrorCallback) onErrorCallback("Could not access camera: " + err.message);
    }
  }

  stopCamera() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }
  }

  /**
   * Decode QR from an uploaded image file
   */
  decodeImageFile(file, onSuccess, onError) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        try {
          const barcodeDetector = await this.createBarcodeDetector();
          if (barcodeDetector) {
            const detections = await barcodeDetector.detect(canvas);
            if (detections.length && detections[0].rawValue) {
              onSuccess(detections[0].rawValue);
              return;
            }
          }
        } catch (err) {
          console.warn("Book code image scan failed:", err);
        }

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        if (typeof jsQR !== "undefined") {
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            onSuccess(code.data);
            return;
          }
        }
        onError("No readable book QR/ISBN barcode found. Please enter the ISBN manually.");
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
}

window.qrManager = new QRCodeManager();
