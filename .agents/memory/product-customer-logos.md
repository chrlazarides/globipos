---
name: Product and customer logos
description: Distinguishes stable GlobiPOS product branding from customer-managed branding.
---

The standalone GlobiPOS Terminal must use the stable blue aperture product mark and GlobiPOS wordmark, never the back-office customer logo.

**Why:** The back-office logo asset is customer-managed and can contain a retailer's identity. Reusing it made a standalone GlobiPOS product appear to belong to one customer.

**How to apply:** For product-level install screens, manifests, and launcher surfaces, use dedicated GlobiPOS assets. Reserve customer logos for customer-branded back-office or storefront contexts.

Check native branding in actual release packages, separately for application icons, installer icons and Android launcher icons. Correct desktop source icons are not proof that every installation surface is correctly branded.

**Why:** Package inspection found correct GlobiPOS icons in macOS/Linux bundles while the Windows setup executable used a generic NSIS icon and the Android APK contained default Tauri launcher artwork.

**How to apply:** Inspect the packaged resources for each surface before saying a native release has the correct branding. Keep verification separate from permission to push, tag or publish a replacement release.

Match package inspection evidence to the exact published bytes, and keep metadata-only inventory checks explicitly separate from branding verification.

**Why:** Successful checks of local build output do not prove the release uploaded those same binaries. PNG resource compression can also change bytes without changing artwork.

**How to apply:** Compare decoded pixels for packaged PNG artwork and match full-package checksums against inspection reports from the same native workflow run. A failed desktop check may occur after the existing release action uploaded assets; it is a readiness failure, not proof that nothing was published.