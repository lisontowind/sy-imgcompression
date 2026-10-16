# Third-party notices

This plugin's original code is MIT licensed. Runtime image codecs are bundled from
[jSquash](https://github.com/jamsinclair/jSquash) (Apache-2.0) and
[wasm-feature-detect](https://github.com/GoogleChromeLabs/wasm-feature-detect) (Apache-2.0).
Their distributed license files and version metadata are included in `licenses/`.
Webpack's extracted JavaScript notices are included beside their bundles.

The codec binaries contain upstream projects with their own licenses:

- WebP: [libwebp](https://chromium.googlesource.com/webm/libwebp/), BSD license and patent grant.
- JPEG: [MozJPEG](https://github.com/mozilla/mozjpeg), with libjpeg/libjpeg-turbo components and their BSD/IJG/zlib notices.
- PNG: [png](https://github.com/image-rs/image-png), MIT / Apache-2.0.
- PNG optimisation: [Oxipng](https://github.com/shssoichiro/oxipng), MIT.
- Resize: [resize](https://github.com/PistonDevelopers/resize), MIT; other resizers shipped by jSquash retain their package notices.

Image handling is local; no code or image is loaded from these project URLs at runtime.
Build and test tools are development dependencies and are not shipped as executable dependencies.

The SiYuan SDK is an external host API; SiYuan kernel source is not bundled or copied into this plugin.
