# Third-party notices

> DRAFT for counsel review. Not legal advice. Generated 2026-10-05 from the dependency
> snapshot described in [`2026-10-third-party-inventory.md`](2026-10-third-party-inventory.md)
> (conva_app v0.6.0, Windows x86_64 desktop build with the `gpu-vulkan` feature, plus the
> browser build's WASM and fonts). Regenerate it when dependencies change.

Conva incorporates or downloads the third-party software, models and fonts listed below.
Each package is listed once, under the licence this draft treats as the one in force for it
(see "How to read this file"). The text of each licence appears once, followed by the
packages that use it.

## How to read this file

- **Elected licence.** Many Rust and npm packages are offered under a choice ("MIT OR Apache-2.0").
  This draft lists each such package under one licence only, preferring the shortest permissive
  option (MIT, then Zlib, BSD, ISC, Unlicense, CC0, Apache-2.0). Packages offered under `AND` are
  listed under every licence named. Which option to elect is a decision for counsel; the full
  expression for each package is in `third-party-inventory.json`.
- **Copyright lines.** The licence text below is shown once with the per-package copyright line
  removed; the copyright line(s) found in each package's licence files appear next to the package.
  Where a package ships no licence file, the entry says "(no licence file in package)" and the
  text shown is the representative text for that licence; the holder is then taken from the
  package manifest authors.
- **Ecosystem tags.** `[rust]` crates linked into the Windows desktop app; `[rust-web-wasm]`
  extra crates in the browser WASM module only; `[npm]` JavaScript shipped in the UI bundle;
  `[native]` vendored or prebuilt C/C++ libraries; `[model]` ML models downloaded at runtime
  (not bundled in the installer); `[font]` bundled web fonts.
- Dev, build-only and compile-time-only (procedural macro) crates are not listed.

## Items that need extra text before shipping

1. **ONNX Runtime third-party notices.** ONNX Runtime is statically linked via the `ort` crate.
   Its upstream project ships a 6,500-line `ThirdPartyNotices.txt` (it includes, among others,
   Apache-2.0, BSD-3-Clause, MPL-2.0 for Eigen, and further notices). That file is **not** inlined here because the exact
   component set of the pyke.io prebuilt binary is unverified. Before release, append the
   upstream file for the version in use, or the one that pyke documents for its build:
   `curl -L https://raw.githubusercontent.com/microsoft/onnxruntime/v1.20.0/ThirdPartyNotices.txt`
2. **ring.** The `ring` crate (`Apache-2.0 AND ISC`) is a composite of ISC, BoringSSL-derived
   (OpenSSL-lineage) and Apache-2.0 code. Its own LICENSE files are reproduced in the "ring"
   appendix at the end of this file.
3. **rav1e patent grant.** `rav1e` ships a PATENTS file (AOMedia patent licence); see the appendix.
4. **MPL-2.0 packages** (see that section): the notice must say where the corresponding Source
   Code Form is available. Source URLs are given in each entry.
5. **Conva's own code** is not covered by this file. Its licence has not been chosen
   (`Cargo.toml` says `UNLICENSED`).


---

## MIT License (MIT) - 388 entries

### Text variant 1 of 20 (242 entries; text taken from adler2/LICENSE-MIT)

```text
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

Entries:

- `[npm]` @tauri-apps/plugin-dialog 2.7.1 - Copyright 2019-2022, The Tauri Programme in the Commons Conservancy (per LICENSE.spdx PackageCopyrightText) (no licence file in package) [offered: MIT OR Apache-2.0]
- `[npm]` @tauri-apps/plugin-process 2.3.1 - Copyright 2019-2022, The Tauri Programme in the Commons Conservancy (per LICENSE.spdx PackageCopyrightText) (no licence file in package) [offered: MIT OR Apache-2.0]
- `[npm]` @tauri-apps/plugin-updater 2.10.1 - Copyright 2019-2022, The Tauri Programme in the Commons Conservancy (per LICENSE.spdx PackageCopyrightText) (no licence file in package) [offered: MIT OR Apache-2.0]
- `[rust]` adler2 2.0.1 - Copyright (C) Jonas Schievink <jonasschievink@gmail.com> [offered: 0BSD OR MIT OR Apache-2.0]
- `[rust]` adobe-cmap-parser 0.4.1 - authors: Jeff Muizelaar (no licence file in package)
- `[rust]` aead 0.5.2 - Copyright (c) 2019 The RustCrypto Project Developers; Copyright (c) 2019 MobileCoin, LLC [offered: MIT OR Apache-2.0]
- `[rust]` aes 0.8.4 - Copyright (c) 2018 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` aes-gcm 0.10.3 - Copyright (c) 2019 The RustCrypto Project Developers [offered: Apache-2.0 OR MIT]
- `[rust]` ahash 0.8.12 - Copyright (c) 2018 Tom Kaitchuck [offered: MIT OR Apache-2.0]
- `[rust]` aligned 0.4.3 - Copyright (c) 2017 Jorge Aparicio [offered: MIT OR Apache-2.0]
- `[rust]` anyhow 1.0.103 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` arrayvec 0.7.8 - Copyright (c) Ulrik Sverdrup "bluss" 2015-2023 [offered: MIT OR Apache-2.0]
- `[rust]` as-slice 0.2.1 - Copyright (c) 2018 Jorge Aparicio [offered: MIT OR Apache-2.0]
- `[rust]` atoi_simd 0.18.1 - Copyright 2022-NOW Dmitry Rodionov; Copyright (c) 2022 Dmitry Rodionov [offered: MIT OR Apache-2.0]
- `[rust]` atomic-waker 1.1.2 - Copyright (c) 2016 Alex Crichton; Copyright (c) 2017 The Tokio Authors [offered: Apache-2.0 OR MIT]
- `[npm]` base64-arraybuffer 1.0.2 - Copyright (c) 2012 Niklas von Hertzen
- `[rust]` bit-set 0.8.0 - Copyright (c) 2023 The Rust Project Developers [offered: Apache-2.0 OR MIT]
- `[rust]` bit-vec 0.8.0 - Copyright (c) 2023 The Rust Project Developers [offered: Apache-2.0 OR MIT]
- `[rust]` bitflags 2.13.0 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` bitstream-io 4.10.0 - Copyright (c) 2017 Brian Langenberger [offered: MIT OR Apache-2.0]
- `[rust]` block-buffer 0.10.4 - Copyright (c) 2018-2019 The RustCrypto Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` block-buffer 0.9.0 - Copyright (c) 2018-2019 The RustCrypto Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` brotli 8.0.4 - Copyright (c) 2016 Dropbox, Inc.; Copyright (c) 2009, 2010, 2013-2016 by the Brotli Authors. [offered: BSD-3-Clause AND MIT]
- `[rust]` bumpalo 3.20.3 - Copyright (c) 2019 Nick Fitzgerald [offered: MIT OR Apache-2.0]
- `[rust]` bytes 1.12.1 - Copyright (c) 2018 Carl Lerche
- `[rust]` camino 1.2.4 - authors: Without Boats, Ashley Williams, Steve Klabnik, Rain [offered: MIT OR Apache-2.0]
- `[rust]` cargo_metadata 0.19.2 - authors: Oliver Schneider
- `[rust]` cargo-platform 0.1.9 - copyright holder not stated [offered: MIT OR Apache-2.0]
- `[rust]` cfg-if 1.0.4 - Copyright (c) 2014 Alex Crichton [offered: MIT OR Apache-2.0]
- `[rust]` chacha20 0.9.1 - Copyright (c) 2019-2023 The RustCrypto Project Developers [offered: Apache-2.0 OR MIT]
- `[rust]` chacha20poly1305 0.10.1 - Copyright (c) 2019 The RustCrypto Project Developers [offered: Apache-2.0 OR MIT]
- `[rust]` cipher 0.4.4 - Copyright (c) 2016-2020 RustCrypto Developers [offered: MIT OR Apache-2.0]
- `[rust]` codepage 0.1.3 - Copyright Mozilla Foundation [offered: Apache-2.0 OR MIT]
- `[rust]` cookie 0.18.1 - Copyright 2017 Sergio Benitez; Copyright 2014 Alex Chricton; Copyright (c) 2017 Sergio Benitez; Copyright (c) 2014 Alex Crichton [offered: MIT OR Apache-2.0]
- `[rust]` cpufeatures 0.2.17 - Copyright (c) 2020-2025 The RustCrypto Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` crypto-common 0.1.7 - Copyright (c) 2021 RustCrypto Developers [offered: MIT OR Apache-2.0]
- `[rust]` crypto-mac 0.11.0 - Copyright (c) 2017 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[npm]` css-line-break 2.1.0 - Copyright (c) 2017 Niklas von Hertzen
- `[rust]` ctor 0.8.0 - authors: Matt Mastracci [offered: Apache-2.0 OR MIT]
- `[rust]` ctr 0.9.2 - Copyright (c) 2018-2022 RustCrypto Developers; Copyright (c) 2018 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` dary_heap 0.3.9 - authors: Han Mertens [offered: MIT OR Apache-2.0]
- `[rust]` dasp_sample 0.11.0 - authors: mitchmindtree (no licence file in package) [offered: MIT OR Apache-2.0]
- `[rust]` debug_unsafe 0.1.4 - Copyright 2025-NOW Dmitry Rodionov; Copyright (c) 2025 Dmitry Rodionov [offered: MIT OR Apache-2.0]
- `[rust]` deranged 0.5.8 - Copyright 2024 Jacob Pratt et al.; Copyright (c) 2024 Jacob Pratt et al. [offered: MIT OR Apache-2.0]
- `[rust]` digest 0.10.7 - Copyright (c) 2017 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` digest 0.9.0 - Copyright (c) 2017 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` dirs 6.0.0 - Copyright (c) 2018-2019 dirs-rs contributors [offered: MIT OR Apache-2.0]
- `[rust]` dirs-sys 0.5.0 - Copyright (c) 2018-2019 dirs-rs contributors [offered: MIT OR Apache-2.0]
- `[rust]` dtoa 1.0.11 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` dtor 0.3.0 - authors: Matt Mastracci [offered: Apache-2.0 OR MIT]
- `[rust]` dyn-clone 1.0.20 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` either 1.16.0 - Copyright (c) 2015 [offered: MIT OR Apache-2.0]
- `[rust]` encoding_rs 0.8.35 - Copyright Mozilla Foundation; Copyright © WHATWG (Apple, Google, Mozilla, Microsoft). [offered: (Apache-2.0 OR MIT) AND BSD-3-Clause]
- `[rust]` equivalent 1.0.2 - Copyright (c) 2016--2023 [offered: Apache-2.0 OR MIT]
- `[rust]` erased-serde 0.4.10 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` euclid 0.20.14 - Copyright (c) 2012-2013 Mozilla Foundation [offered: MIT OR Apache-2.0]
- `[rust]` fast-float2 0.2.4 - Copyright 2021 Ivan Smirnov [offered: MIT OR Apache-2.0]
- `[rust]` fastrand 2.4.1 - authors: Stjepan Glavina [offered: Apache-2.0 OR MIT]
- `[rust]` flate2 1.1.9 - Copyright (c) 2014-2026 Alex Crichton [offered: MIT OR Apache-2.0]
- `[rust]` fnv 1.0.7 - Copyright (c) 2017 Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` form_urlencoded 1.2.2 - Copyright (c) 2013-2016 The rust-url developers [offered: MIT OR Apache-2.0]
- `[rust]` futures-channel 0.3.32 - Copyright (c) 2016 Alex Crichton; Copyright (c) 2017 The Tokio Authors [offered: MIT OR Apache-2.0]
- `[rust]` futures-core 0.3.32 - Copyright (c) 2016 Alex Crichton; Copyright (c) 2017 The Tokio Authors [offered: MIT OR Apache-2.0]
- `[rust]` futures-io 0.3.32 - Copyright (c) 2016 Alex Crichton; Copyright (c) 2017 The Tokio Authors [offered: MIT OR Apache-2.0]
- `[rust]` futures-sink 0.3.32 - Copyright (c) 2016 Alex Crichton; Copyright (c) 2017 The Tokio Authors [offered: MIT OR Apache-2.0]
- `[rust]` futures-task 0.3.32 - Copyright (c) 2016 Alex Crichton; Copyright (c) 2017 The Tokio Authors [offered: MIT OR Apache-2.0]
- `[rust]` futures-util 0.3.32 - Copyright (c) 2016 Alex Crichton; Copyright (c) 2017 The Tokio Authors [offered: MIT OR Apache-2.0]
- `[rust]` getrandom 0.2.17 - Copyright (c) 2018-2024 The rust-random Project Developers; Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` getrandom 0.3.4 - Copyright (c) 2018-2025 The rust-random Project Developers; Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` getrandom 0.4.3 - Copyright (c) 2018-2026 The rust-random Project Developers; Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` ghash 0.5.1 - Copyright (c) 2019 RustCrypto Developers [offered: Apache-2.0 OR MIT]
- `[rust]` glob 0.3.3 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` h2 0.4.15 - Copyright (c) 2017 h2 authors
- `[rust]` hashbrown 0.12.3 - Copyright (c) 2016 Amanieu d'Antras [offered: MIT OR Apache-2.0]
- `[rust]` hashbrown 0.17.1 - Copyright (c) 2016 Amanieu d'Antras [offered: MIT OR Apache-2.0]
- `[rust]` heck 0.5.0 - Copyright (c) 2015 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` hex 0.4.3 - Copyright (c) 2013-2014 The Rust Project Developers.; Copyright (c) 2015-2020 The rust-hex Developers [offered: MIT OR Apache-2.0]
- `[rust]` hmac 0.11.0 - Copyright (c) 2017 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[npm]` html2canvas 1.4.1 - Copyright (c) 2012 Niklas von Hertzen
- `[rust]` html5ever 0.38.0 - Copyright (c) 2014 The html5ever Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` http 1.4.2 - Copyright 2017 http-rs authors; Copyright (c) 2017 http-rs authors [offered: MIT OR Apache-2.0]
- `[rust]` http-body 1.0.1 - Copyright (c) 2019-2024 Sean McArthur & Hyper Contributors
- `[rust]` http-body-util 0.1.3 - Copyright (c) 2019-2025 Sean McArthur & Hyper Contributors
- `[rust]` httparse 1.10.1 - Copyright (c) 2015-2025 Sean McArthur [offered: MIT OR Apache-2.0]
- `[rust]` hyper 1.10.1 - Copyright (c) 2014-2026 Sean McArthur
- `[rust]` hyper-rustls 0.27.9 - Copyright (c) 2016, Joseph Birr-Pixton <jpixton@gmail.com>; Copyright (c) 2016 Joseph Birr-Pixton <jpixton@gmail.com> [offered: Apache-2.0 OR ISC OR MIT]
- `[rust]` hyper-tls 0.6.0 - Copyright (c) 2017 Sean McArthur [offered: MIT OR Apache-2.0]
- `[rust]` hyper-util 0.1.20 - Copyright (c) 2023-2025 Sean McArthur
- `[rust]` idna 1.1.0 - Copyright (c) 2013-2025 The rust-url developers [offered: MIT OR Apache-2.0]
- `[rust]` idna_adapter 1.2.2 - Copyright (c) The rust-url developers [offered: Apache-2.0 OR MIT]
- `[rust]` indexmap 1.9.3 - Copyright (c) 2016--2017 [offered: Apache-2.0 OR MIT]
- `[rust]` indexmap 2.14.0 - Copyright (c) 2016--2017 [offered: Apache-2.0 OR MIT]
- `[rust]` inout 0.1.4 - Copyright (c) 2022 The RustCrypto Project Developers; Copyright (c) 2022 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` ipnet 2.12.0 - Copyright 2017 Juniper Networks, Inc. [offered: MIT OR Apache-2.0]
- `[rust]` itertools 0.14.0 - Copyright (c) 2015 [offered: MIT OR Apache-2.0]
- `[rust]` itoa 1.0.18 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust-web-wasm]` js-sys 0.3.103 - Copyright (c) 2014 Alex Crichton [offered: MIT OR Apache-2.0]
- `[rust]` keyboard-types 0.7.0 - Copyright (c) 2017 Pyfisch [offered: MIT OR Apache-2.0]
- `[rust]` keyring 3.6.3 - Copyright (c) 2016 keyring Developers [offered: MIT OR Apache-2.0]
- `[rust]` libc 0.2.186 - Copyright (c) The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` lock_api 0.4.14 - Copyright (c) 2016 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` log 0.4.33 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` markup5ever 0.38.0 - Copyright (c) 2014 The html5ever Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` md-5 0.10.6 - Copyright (c) 2006-2009 Graydon Hoare; Copyright (c) 2009-2013 Mozilla Foundation; Copyright (c) 2016 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` mime 0.3.17 - Copyright (c) 2014 Sean McArthur [offered: MIT OR Apache-2.0]
- `[rust]` minimal-lexical 0.2.1 - Copyright (c) 2009 The Go Authors. All rights reserved. [offered: MIT OR Apache-2.0]
- `[rust]` mio 1.2.1 - Copyright (c) 2014 Carl Lerche and other MIO contributors
- `[rust]` monostate 0.1.18 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` native-tls 0.2.18 - Copyright (c) 2016 The rust-native-tls Developers [offered: MIT OR Apache-2.0]
- `[rust]` new_debug_unreachable 1.0.6 - Copyright (c) 2015 Jonathan Reem
- `[rust]` no_std_io2 0.9.4 - Copyright (c) 2020-2021 Brendan Molloy <brendan@bbqsrc.net> [offered: Apache-2.0 OR MIT]
- `[rust]` nom 7.1.3 - Copyright (c) 2014-2019 Geoffroy Couprie
- `[rust]` nom 8.0.0 - Copyright (c) 2014-2019 Geoffroy Couprie
- `[rust]` num-bigint 0.4.8 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` num-complex 0.4.6 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` num-conv 0.2.2 - Copyright (c) Jacob Pratt [offered: MIT OR Apache-2.0]
- `[rust]` num-integer 0.1.46 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` num-rational 0.4.2 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` num-traits 0.2.19 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` number_prefix 0.4.0 - authors: Benjamin Sago (no licence file in package)
- `[rust]` once_cell 1.21.4 - authors: Aleksey Kladov [offered: MIT OR Apache-2.0]
- `[rust]` opaque-debug 0.3.1 - Copyright (c) 2018-2024 The RustCrypto Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` parking_lot 0.12.5 - Copyright (c) 2016 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` parking_lot_core 0.9.12 - Copyright (c) 2016 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` pbkdf2 0.9.0 - Copyright (c) 2017 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` pdf-extract 0.7.12 - authors: Jeff Muizelaar (no licence file in package)
- `[rust]` percent-encoding 2.3.2 - Copyright (c) 2013-2025 The rust-url developers [offered: MIT OR Apache-2.0]
- `[rust]` pin-project-lite 0.2.17 - copyright holder not stated [offered: Apache-2.0 OR MIT]
- `[rust]` plist 1.10.0 - Copyright (c) 2015 Edward Barnard
- `[rust]` png 0.18.1 - Copyright (c) 2015 nwin [offered: MIT OR Apache-2.0]
- `[rust]` poly1305 0.8.0 - Copyright (c) 2015-2019 RustCrypto Developers [offered: Apache-2.0 OR MIT]
- `[rust]` polyval 0.6.2 - Copyright (c) 2019-2023 RustCrypto Developers [offered: Apache-2.0 OR MIT]
- `[rust]` portable-atomic 1.13.1 - copyright holder not stated [offered: Apache-2.0 OR MIT]
- `[rust]` powerfmt 0.2.0 - Copyright 2023 Jacob Pratt et al.; Copyright (c) 2023 Jacob Pratt et al. [offered: MIT OR Apache-2.0]
- `[rust]` ppv-lite86 0.2.21 - Copyright 2019 The CryptoCorrosion Contributors; Copyright (c) 2019 The CryptoCorrosion Contributors [offered: MIT OR Apache-2.0]
- `[rust]` proc-macro2 1.0.106 - authors: David Tolnay, Alex Crichton [offered: MIT OR Apache-2.0]
- `[rust]` profiling 1.0.18 - authors: Philip Degarmo (no licence file in package) [offered: MIT OR Apache-2.0]
- `[rust]` pulp-wasm-simd-flag 0.1.1 - authors: sarah quiñones (no licence file in package)
- `[rust]` qoi 0.4.1 - Copyright (c) 2022 Ivan Smirnov [offered: MIT OR Apache-2.0]
- `[rust]` quick-error 2.0.1 - Copyright (c) 2015 The quick-error Developers [offered: MIT OR Apache-2.0]
- `[rust]` quote 1.0.46 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` rand 0.8.7 - Copyright 2018 Developers of the Rand project; Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` rand 0.9.4 - Copyright 2018 Developers of the Rand project; Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` rand_chacha 0.3.1 - Copyright 2018 Developers of the Rand project; Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` rand_chacha 0.9.0 - Copyright 2018 Developers of the Rand project; Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` rand_core 0.6.4 - Copyright 2018 Developers of the Rand project; Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` rand_core 0.9.5 - Copyright 2018 Developers of the Rand project; Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` rangemap 1.7.1 - Copyright 2019-2022 Jeff Parsons, and [contributors](https://github.com/jeffparsons/rangemap/contributors); Copyright 2019 Jeffrey Parsons [offered: MIT OR Apache-2.0]
- `[rust]` rawpointer 0.2.1 - Copyright (c) 2015 [offered: MIT OR Apache-2.0]
- `[rust]` rayon 1.12.0 - Copyright (c) 2010 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` rayon-cond 0.4.0 - Copyright (c) 2018 Josh Stone [offered: Apache-2.0 OR MIT]
- `[rust]` rayon-core 1.13.0 - Copyright (c) 2010 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` ref-cast 1.0.25 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` regex 1.12.4 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` regex-automata 0.4.14 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` regex-syntax 0.8.11 - Copyright (c) 2014 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` reqwest 0.12.4 - Copyright 2016 Sean McArthur; Copyright (c) 2016 Sean McArthur [offered: MIT OR Apache-2.0]
- `[rust]` reqwest 0.13.4 - Copyright 2016 Sean McArthur; Copyright (c) 2016-2026 Sean McArthur [offered: MIT OR Apache-2.0]
- `[rust]` rtrb 0.3.4 - authors: Stjepan Glavina, Matthias Geier [offered: MIT OR Apache-2.0]
- `[rust]` rustc-hash 2.1.3 - authors: The Rust Project Developers [offered: Apache-2.0 OR MIT]
- `[rust]` rustls 0.21.12 - Copyright (c) 2016, Joseph Birr-Pixton <jpixton@gmail.com>; Copyright (c) 2016 Joseph Birr-Pixton <jpixton@gmail.com> [offered: Apache-2.0 OR ISC OR MIT]
- `[rust]` rustls 0.23.42 - Copyright (c) 2016, Joseph Birr-Pixton <jpixton@gmail.com>; Copyright (c) 2016 Joseph Birr-Pixton <jpixton@gmail.com> [offered: Apache-2.0 OR ISC OR MIT]
- `[rust]` rustls-pemfile 2.2.0 - Copyright (c) 2016, Joseph Birr-Pixton <jpixton@gmail.com>; Copyright (c) 2016 Joseph Birr-Pixton <jpixton@gmail.com> [offered: Apache-2.0 OR ISC OR MIT]
- `[rust]` rustls-pki-types 1.15.0 - Copyright 2023 Dirkjan Ochtman; Copyright (c) 2023 Dirkjan Ochtman <dirkjan@ochtman.nl> [offered: MIT OR Apache-2.0]
- `[rust]` schannel 0.1.29 - Copyright (c) 2015 steffengy
- `[rust]` scopeguard 1.2.0 - Copyright (c) 2016-2019 Ulrik Sverdrup "bluss" and scopeguard developers [offered: MIT OR Apache-2.0]
- `[rust]` sct 0.7.1 - Copyright (c) 2016, Joseph Birr-Pixton <jpixton@gmail.com>; Copyright (c) 2016 Joseph Birr-Pixton <jpixton@gmail.com> [offered: Apache-2.0 OR ISC OR MIT]
- `[rust]` semver 1.0.28 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` serde 1.0.228 - authors: Erick Tryzelaar, David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` serde_core 1.0.228 - authors: Erick Tryzelaar, David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` serde_json 1.0.150 - authors: Erick Tryzelaar, David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` serde_spanned 1.1.1 - Copyright (c) Individual contributors [offered: MIT OR Apache-2.0]
- `[rust]` serde_urlencoded 0.7.1 - Copyright (c) 2016 Anthony Ramine [offered: MIT OR Apache-2.0]
- `[rust]` serde_with 3.21.0 - Copyright (c) 2015 [offered: MIT OR Apache-2.0]
- `[rust]` serde-untagged 0.1.9 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` servo_arc 0.4.3 - authors: The Servo Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` sha1 0.10.7 - Copyright (c) 2006-2009 Graydon Hoare; Copyright (c) 2009-2013 Mozilla Foundation; Copyright (c) 2016 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` sha2 0.10.9 - Copyright (c) 2006-2009 Graydon Hoare; Copyright (c) 2009-2013 Mozilla Foundation; Copyright (c) 2016 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` sha2 0.9.9 - Copyright (c) 2006-2009 Graydon Hoare; Copyright (c) 2009-2013 Mozilla Foundation; Copyright (c) 2016 Artyom Pavlov [offered: MIT OR Apache-2.0]
- `[rust]` slab 0.4.12 - Copyright (c) 2019 Carl Lerche
- `[rust]` smallvec 1.15.2 - Copyright (c) 2018 The Servo Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` socket2 0.6.4 - Copyright (c) 2014 Alex Crichton [offered: MIT OR Apache-2.0]
- `[rust]` socks 0.3.4 - Copyright (c) 2015 The rust-socks Developers [offered: MIT OR Apache-2.0]
- `[rust]` softbuffer 0.4.8 - Copyright 2022 Kirill Chibisov [offered: MIT OR Apache-2.0]
- `[rust]` stable_deref_trait 1.2.1 - Copyright (c) 2017 Robert Grosse [offered: MIT OR Apache-2.0]
- `[rust]` string_cache 0.9.0 - Copyright (c) 2012-2013 Mozilla Foundation [offered: MIT OR Apache-2.0]
- `[rust]` tempfile 3.27.0 - Copyright (c) 2015 Steven Allen [offered: MIT OR Apache-2.0]
- `[rust]` tendril 0.5.1 - Copyright (c) 2015 Keegan McAllister [offered: MIT OR Apache-2.0]
- `[npm]` text-segmentation 1.0.3 - Copyright (c) 2021 Niklas von Hertzen
- `[rust]` thiserror 1.0.69 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` thiserror 2.0.18 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` time 0.3.53 - Copyright (c) Jacob Pratt et al. [offered: MIT OR Apache-2.0]
- `[rust]` time-core 0.1.9 - Copyright (c) Jacob Pratt et al. [offered: MIT OR Apache-2.0]
- `[rust]` tinyvec 1.11.0 - Copyright (c) 2019 Daniel "Lokathor" Gee. [offered: Zlib OR Apache-2.0 OR MIT]
- `[rust]` tokio-native-tls 0.3.1 - Copyright (c) 2019 Tokio Contributors
- `[rust]` tokio-rustls 0.26.4 - Copyright 2017 quininer kel; Copyright (c) 2017 quininer kel [offered: MIT OR Apache-2.0]
- `[rust]` toml 1.1.2+spec-1.1.0 - Copyright (c) Individual contributors [offered: MIT OR Apache-2.0]
- `[rust]` toml_datetime 1.1.1+spec-1.1.0 - Copyright (c) Individual contributors [offered: MIT OR Apache-2.0]
- `[rust]` toml_parser 1.1.2+spec-1.1.0 - Copyright (c) Individual contributors [offered: MIT OR Apache-2.0]
- `[rust]` toml_writer 1.1.1+spec-1.1.0 - Copyright (c) Individual contributors [offered: MIT OR Apache-2.0]
- `[rust]` tower 0.5.3 - Copyright (c) 2019 Tower Contributors
- `[rust]` tower-http 0.6.11 - Copyright (c) 2019-2021 Tower Contributors
- `[rust]` tower-layer 0.3.3 - Copyright (c) 2019 Tower Contributors
- `[rust]` tower-service 0.3.3 - Copyright (c) 2019 Tower Contributors
- `[rust]` tracing 0.1.44 - Copyright (c) 2019 Tokio Contributors
- `[rust]` tracing-core 0.1.36 - Copyright (c) 2019 Tokio Contributors
- `[rust]` try-lock 0.2.5 - Copyright (c) 2018-2023 Sean McArthur; Copyright (c) 2016 Alex Crichton
- `[rust]` tungstenite 0.24.0 - Copyright (c) 2017 Alexey Galakhov; Copyright (c) 2016 Jason Housley [offered: MIT OR Apache-2.0]
- `[rust]` type1-encoding-parser 0.1.1 - authors: Jeff Muizelaar (no licence file in package)
- `[rust]` typed-path 0.12.3 - authors: Chip Senkbeil [offered: MIT OR Apache-2.0]
- `[rust]` typeid 1.0.3 - authors: David Tolnay [offered: MIT OR Apache-2.0]
- `[rust]` unic-char-property 0.9.0 - authors: The UNIC Project Developers (no licence file in package) [offered: MIT OR Apache-2.0]
- `[rust]` unic-char-range 0.9.0 - authors: The UNIC Project Developers (no licence file in package) [offered: MIT OR Apache-2.0]
- `[rust]` unic-common 0.9.0 - authors: The UNIC Project Developers (no licence file in package) [offered: MIT OR Apache-2.0]
- `[rust]` unic-ucd-ident 0.9.0 - authors: The UNIC Project Developers (no licence file in package) [offered: MIT OR Apache-2.0]
- `[rust]` unic-ucd-version 0.9.0 - authors: The UNIC Project Developers (no licence file in package) [offered: MIT OR Apache-2.0]
- `[rust]` unicode_categories 0.1.1 - Copyright (c) 2015 The unicode-categories Developers [offered: MIT OR Apache-2.0]
- `[rust]` unicode-ident 1.0.24 - Copyright © 1991-2023 Unicode, Inc. [offered: (MIT OR Apache-2.0) AND Unicode-3.0]
- `[rust]` unicode-normalization 0.1.25 - Copyright (c) 2015 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` unicode-normalization-alignments 0.1.12 - Copyright (c) 2015 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` unicode-segmentation 1.13.3 - Copyright (c) 2015 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` unicode-width 0.2.2 - Copyright (c) 2015 The Rust Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` universal-hash 0.5.1 - Copyright (c) 2019-2020 RustCrypto Developers [offered: MIT OR Apache-2.0]
- `[rust]` url 2.5.8 - Copyright (c) 2013-2025 The rust-url developers [offered: MIT OR Apache-2.0]
- `[rust]` urlencoding 2.1.3 - © 2016 Bertram Truong; © 2021 Kornel Lesiński
- `[rust]` utf-8 0.7.6 - authors: Simon Sapin [offered: MIT OR Apache-2.0]
- `[rust]` utf8_iter 1.0.4 - Copyright Mozilla Foundation [offered: Apache-2.0 OR MIT]
- `[npm]` utrie 1.0.2 - Copyright (c) 2021 Niklas von Hertzen
- `[rust]` uuid 1.23.4 - Copyright (c) 2014 The Rust Project Developers; Copyright (c) 2018 Ashley Mannix, Christopher Armstrong, Dylan DPC, Hunar Roop Kahlon [offered: Apache-2.0 OR MIT]
- `[rust]` want 0.3.1 - Copyright (c) 2018-2019 Sean McArthur
- `[rust]` wasm-bindgen 0.2.126 - Copyright (c) 2014 Alex Crichton [offered: MIT OR Apache-2.0]
- `[rust]` wasm-bindgen-shared 0.2.126 - Copyright (c) 2014 Alex Crichton [offered: MIT OR Apache-2.0]
- `[rust]` web_atoms 0.2.5 - Copyright (c) 2014 The html5ever Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` webview2-com 0.38.2 - copyright holder not stated (no licence file in package)
- `[rust]` webview2-com-sys 0.38.2 - copyright holder not stated (no licence file in package)
- `[rust]` winapi 0.3.9 - Copyright (c) 2015-2018 The winapi-rs Developers [offered: MIT OR Apache-2.0]
- `[rust]` winnow 1.0.3 - copyright holder not stated
- `[rust]` winreg 0.52.0 - Copyright (c) 2015 Igor Shaula
- `[rust]` zerocopy 0.8.54 - Copyright 2023 The Fuchsia Authors; Copyright 2019 The Fuchsia Authors. [offered: BSD-2-Clause OR Apache-2.0 OR MIT]
- `[rust]` zeroize 1.9.0 - Copyright (c) 2018-2026 The RustCrypto Project Developers [offered: Apache-2.0 OR MIT]
- `[rust]` zmij 1.0.21 - authors: David Tolnay
- `[rust]` zune-inflate 0.2.54 - copyright holder not stated (no licence file in package) [offered: MIT OR Apache-2.0 OR Zlib]

### Text variant 2 of 20 (69 entries; text taken from aligned-vec/LICENSE)

```text
[Copyright line(s): see each entry below]

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Entries:

- `[npm]` @tanstack/react-virtual 3.14.13 - Copyright (c) 2021-present Tanner Linsley
- `[npm]` @tanstack/virtual-core 3.17.11 - Copyright (c) 2021-present Tanner Linsley
- `[npm]` @tauri-apps/api 2.11.1 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` aligned-vec 0.6.4 - Copyright (c) 2022 sarah
- `[rust]` av-scenechange 0.14.1 - Copyright (c) 2019 Multimedia and Rust
- `[model]` BAAI bge-small-en-v1.5 (fetched at runtime as Xenova/bge-small-en-v1.5 ONNX conversion) v1.5 - MIT per Hugging Face model card (BAAI/bge-small-en-v1.5); the model repo carries no copyright line. Source-code repo FlagOpen/FlagEmbedding states "Copyright (c) 2022 staoxiao".
- `[rust]` bs58 0.5.1 - Copyright (c) 2016 The roaring-rs developers. [offered: MIT OR Apache-2.0]
- `[rust]` castaway 0.2.4 - Copyright (c) 2021 Stephen M. Coakley
- `[rust]` cfb 0.7.3 - Copyright (c) 2017 Matthew D. Steele
- `[rust]` cocoon 0.4.3 - Copyright (c) 2020 Alexander Fadeev
- `[rust]` compact_str 0.9.1 - Copyright (c) 2021 Parker Timmerman
- `[rust]` crc32fast 1.5.0 - Copyright (c) 2018 Sam Rijs, Alex Crichton and contributors [offered: MIT OR Apache-2.0]
- `[rust]` equator 0.4.2 - Copyright (c) 2023 sarah
- `[rust]` fdeflate 0.3.7 - authors: The image-rs Developers [offered: MIT OR Apache-2.0]
- `[rust]` half 2.7.1 - authors: Kathryn Long [offered: MIT OR Apache-2.0]
- `[rust]` image 0.25.10 - authors: The image-rs Developers [offered: MIT OR Apache-2.0]
- `[rust]` image-webp 0.2.4 - copyright holder not stated [offered: MIT OR Apache-2.0]
- `[rust]` infer 0.19.0 - Copyright (c) 2019 Bojan
- `[rust]` json-patch 3.0.1 - Copyright (c) 2017 Ivan Dubrov [offered: MIT OR Apache-2.0]
- `[rust]` jsonptr 0.6.3 - Copyright 2024 Chance Dinkins; Copyright (c) 2022 Chance Dinkins [offered: MIT OR Apache-2.0]
- `[rust]` lopdf 0.34.0 - Copyright (c) 2016 Junfeng Liu
- `[rust]` macro_rules_attribute 0.2.2 - Copyright 2019 Daniel Henry-Mantilla <daniel.henry.mantilla@gmail.com>; Copyright (c) 2019 Daniel Henry-Mantilla <daniel.henry.mantilla@gmail.com> [offered: Apache-2.0 OR MIT OR Zlib]
- `[rust]` maybe-rayon 0.1.1 - Copyright (c) 2021 Joshua Holmer
- `[rust]` miniz_oxide 0.8.9 - Copyright 2013-2014 RAD Game Tools and Valve Software; Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC; Copyright (c) 2017 Frommi; Copyright (c) 2017-2024 oyvindln; Copyright (c) 2020 Frommi [offered: MIT OR Zlib OR Apache-2.0]
- `[rust]` muda 0.19.3 - Copyright (c) 2022-2022 Tauri Programme within The Commons Conservancy [offered: Apache-2.0 OR MIT]
- `[native]` ONNX Runtime 1.20.0 (statically linked prebuilt binary fetched by ort-sys at build time) 1.20.0 - Copyright (c) Microsoft Corporation
- `[model]` OpenAI Whisper (original model weights; ggml conversions are fetched at runtime from ggerganov/whisper.cpp on Hugging Face) - Copyright (c) 2022 OpenAI
- `[rust]` pom 1.1.0 - Copyright (c) 2016 Junfeng Liu
- `[rust]` precomputed-hash 0.1.1 - Copyright (c) 2017 Emilio Cobos Álvarez
- `[rust]` pulp 0.22.3 - Copyright (c) 2021 sarah
- `[rust]` raw-window-handle 0.6.2 - Copyright (c) 2019 Osspial; Copyright (c) 2020 Osspial [offered: MIT OR Apache-2.0 OR Zlib]
- `[npm]` react 19.2.7 - Copyright (c) Meta Platforms, Inc. and affiliates.
- `[npm]` react-dom 19.2.7 - Copyright (c) Meta Platforms, Inc. and affiliates.
- `[rust]` reborrow 0.5.5 - Copyright (c) 2022 sarah
- `[rust]` rfd 0.16.0 - Copyright (c) 2022 Bartłomiej Maryńczak
- `[rust]` rgb 0.8.53 - Copyright (c) 2019 Kornel
- `[rust]` rustls-platform-verifier 0.7.0 - Copyright (c) 2022 1Password [offered: MIT OR Apache-2.0]
- `[npm]` scheduler 0.27.0 - Copyright (c) Meta Platforms, Inc. and affiliates.
- `[rust]` schemars 0.8.22 - Copyright (c) 2019 Graham Esau
- `[rust]` schemars 0.9.0 - Copyright (c) 2019 Graham Esau
- `[rust]` schemars 1.2.1 - Copyright (c) 2019 Graham Esau
- `[rust-web-wasm]` serde-wasm-bindgen 0.6.5 - Copyright (c) 2019 Cloudflare, Inc.
- `[rust]` serialize-to-javascript 0.1.2 - Copyright (c) 2021 Chip Reed [offered: MIT OR Apache-2.0]
- `[model]` Silero VAD v5 (silero_vad.onnx, fetched at runtime) v5 - Copyright (c) 2020-present Silero Team
- `[rust]` simd-adler32 0.3.9 - Copyright (c) [2021] [Marvin Countryman]
- `[rust]` static_assertions 1.1.0 - Copyright (c) 2017 Nikolai Vazquez [offered: MIT OR Apache-2.0]
- `[rust]` tauri 2.11.5 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` tauri-plugin-deep-link 2.4.9 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` tauri-plugin-dialog 2.7.1 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` tauri-plugin-fs 2.5.1 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` tauri-plugin-process 2.3.1 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` tauri-plugin-single-instance 2.4.3 - Copyright (c) 2017 - Present The Tauri Programme in the Commons Conservancy [offered: Apache-2.0 OR MIT]
- `[rust]` tauri-plugin-updater 2.10.1 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` tauri-runtime 2.11.3 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` tauri-runtime-wry 2.11.4 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` tauri-utils 2.9.3 - Copyright (c) 2017 - Present Tauri Apps Contributors [offered: Apache-2.0 OR MIT]
- `[rust]` tiff 0.11.3 - Copyright (c) 2018 PistonDevelopers
- `[rust]` tinyvec_macros 0.1.1 - Copyright 2020 Tomasz "Soveu" Marx; Copyright (c) 2020 Soveu [offered: MIT OR Apache-2.0 OR Zlib]
- `[rust]` tokio 1.52.3 - Copyright (c) Tokio Contributors
- `[rust]` tokio-util 0.7.18 - Copyright (c) Tokio Contributors
- `[rust]` tray-icon 0.24.1 - Copyright (c) 2022-2022 Tauri Programme within The Commons Conservancy [offered: MIT OR Apache-2.0]
- `[rust]` ureq 2.9.1 - Copyright (c) 2019 Martin Algesten [offered: MIT OR Apache-2.0]
- `[rust]` urlpattern 0.3.0 - Copyright (c) 2021 the Deno authors
- `[native]` whisper.cpp / ggml (vendored in whisper-rs-sys 0.13.1) vendored - Copyright (c) 2023-2024 The ggml authors (vendored whisper.cpp/LICENSE)
- `[rust]` window-vibrancy 0.6.0 - Copyright (c) 2020-2022 Tauri Programme within The Commons Conservancy [offered: Apache-2.0 OR MIT]
- `[rust]` wry 0.55.1 - Copyright (c) 2020-2023 Ngo Iok Ui & Tauri Programme within The Commons Conservancy [offered: Apache-2.0 OR MIT]
- `[rust]` zune-core 0.5.1 - Copyright (c) zune-image developers [offered: MIT OR Apache-2.0 OR Zlib]
- `[rust]` zune-jpeg 0.5.15 - Copyright (c) zune-image developers [offered: MIT OR Apache-2.0 OR Zlib]
- `[npm]` zustand 5.0.14 - Copyright (c) 2019 Paul Henschel

### Text variant 3 of 20 (34 entries; text taken from aho-corasick/LICENSE-MIT)

```text
[Copyright line(s): see each entry below]

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

Entries:

- `[rust]` aho-corasick 1.1.4 - Copyright (c) 2015 Andrew Gallant [offered: Unlicense OR MIT]
- `[rust]` base64 0.13.1 - Copyright (c) 2015 Alice Maz [offered: MIT OR Apache-2.0]
- `[rust]` base64 0.21.7 - Copyright (c) 2015 Alice Maz [offered: MIT OR Apache-2.0]
- `[rust]` base64 0.22.1 - Copyright (c) 2015 Alice Maz [offered: MIT OR Apache-2.0]
- `[rust]` bit_field 0.10.3 - Copyright (c) 2016 Philipp Oppermann [offered: Apache-2.0 OR MIT]
- `[rust]` byteorder 1.5.0 - Copyright (c) 2015 Andrew Gallant [offered: Unlicense OR MIT]
- `[rust]` byteorder-lite 0.1.0 - Copyright (c) 2015 Andrew Gallant [offered: Unlicense OR MIT]
- `[rust]` calamine 0.36.1 - Copyright (c) 2016 Johann Tuffe
- `[rust]` color_quant 1.1.0 - Copyright (c) 2016 PistonDevelopers
- `[rust]` console 0.15.11 - Copyright (c) 2017 Armin Ronacher <armin.ronacher@active-4.com>
- `[rust]` crossbeam-channel 0.5.16 - Copyright (c) 2019 The Crossbeam Project Developers; Copyright (c) 2009 The Go Authors. All rights reserved. [offered: MIT OR Apache-2.0]
- `[rust]` crossbeam-deque 0.8.7 - Copyright (c) 2019 The Crossbeam Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` crossbeam-epoch 0.9.20 - Copyright (c) 2019 The Crossbeam Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` crossbeam-utils 0.8.22 - Copyright (c) 2019 The Crossbeam Project Developers [offered: MIT OR Apache-2.0]
- `[rust]` csv 1.4.0 - Copyright (c) 2015 Andrew Gallant [offered: Unlicense OR MIT]
- `[rust]` csv-core 0.1.13 - Copyright (c) 2015 Andrew Gallant [offered: Unlicense OR MIT]
- `[rust]` data-encoding 2.11.0 - Copyright (c) 2015-2020 Julien Cretin; Copyright (c) 2017-2020 Google Inc.
- `[rust]` derive_builder 0.20.2 - Copyright (c) 2016 rust-derive-builder contributors [offered: MIT OR Apache-2.0]
- `[rust]` derive_more 2.1.1 - Copyright (c) 2016 Jelte Fennema
- `[rust]` generic-array 0.14.7 - Copyright (c) 2015 Bartłomiej Kamiński
- `[rust]` gif 0.14.2 - Copyright (c) 2015 nwin [offered: MIT OR Apache-2.0]
- `[rust]` indicatif 0.17.11 - Copyright (c) 2017 Armin Ronacher <armin.ronacher@active-4.com>
- `[rust]` memchr 2.8.3 - Copyright (c) 2015 Andrew Gallant [offered: Unlicense OR MIT]
- `[rust]` phf 0.13.1 - Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi
- `[rust]` phf_shared 0.13.1 - Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi
- `[rust]` quick-xml 0.41.0 - Copyright (c) 2016 Johann Tuffe
- `[rust]` raw-cpuid 11.6.0 - Copyright (c) 2015 Gerd Zellweger
- `[rust]` same-file 1.0.6 - Copyright (c) 2017 Andrew Gallant [offered: Unlicense OR MIT]
- `[rust]` typenum 1.20.1 - Copyright 2014 Paho Lurie-Gregg; Copyright (c) 2014 Paho Lurie-Gregg [offered: MIT OR Apache-2.0]
- `[rust]` walkdir 2.5.0 - Copyright (c) 2015 Andrew Gallant [offered: Unlicense OR MIT]
- `[rust]` weezl 0.1.12 - Copyright (c) HeroicKatora 2020 [offered: MIT OR Apache-2.0]
- `[rust]` winapi-util 0.1.11 - Copyright (c) 2017 Andrew Gallant [offered: Unlicense OR MIT]
- `[rust]` y4m 0.8.0 - Copyright (c) 2015-2019 PistonDevelopers; Copyright (c) 2019 image-rs contributors
- `[rust]` zip 8.6.0 - Copyright (c) 2014 Mathijs van de Nes

### Text variant 4 of 20 (25 entries; text taken from windows/license-mit)

```text
[Copyright line(s): see each entry below]

MIT License

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE
```

Entries:

- `[rust]` windows 0.54.0 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows 0.61.3 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows_x86_64_msvc 0.48.5 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows_x86_64_msvc 0.52.6 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows_x86_64_msvc 0.53.1 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-collections 0.2.0 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-core 0.54.0 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-core 0.61.2 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-future 0.2.1 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-link 0.1.3 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-link 0.2.1 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-numerics 0.2.0 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-registry 0.5.3 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-result 0.1.2 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-result 0.3.4 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-strings 0.4.2 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-sys 0.48.0 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-sys 0.59.0 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-sys 0.60.2 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-sys 0.61.2 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-targets 0.48.5 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-targets 0.52.6 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-targets 0.53.5 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-threading 0.1.0 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]
- `[rust]` windows-version 0.1.7 - Copyright (c) Microsoft Corporation. [offered: MIT OR Apache-2.0]

### Text variant 5 of 20 (2 entries; text taken from ort/LICENSE-MIT)

```text
[Copyright line(s): see each entry below]

MIT License

              2020 Nicolas Bigaouette

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Entries:

- `[rust]` ort 2.0.0-rc.9 - Copyright (c) 2023 pyke.io [offered: MIT OR Apache-2.0]
- `[rust]` ort-sys 2.0.0-rc.9 - Copyright (c) 2023 pyke.io [offered: MIT OR Apache-2.0]

### Text variant 6 of 20 (2 entries; text taken from zip/LICENSE)

```text
[Copyright line(s): see each entry below]

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Some files in the "tests/data" subdirectory of this repository are under other
licences; see files named LICENSE.*.txt for details.
```

Entries:

- `[rust]` zip 2.4.2 - Copyright (c) 2014 Mathijs van de Nes
- `[rust]` zip 4.6.1 - Copyright (c) 2014 Mathijs van de Nes

### Text variant 7 of 20 (1 entries; text taken from bytemuck/LICENSE-MIT)

```text
[Copyright line(s): see each entry below]

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice (including the next paragraph) shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Entries:

- `[rust]` bytemuck 1.25.0 - Copyright (c) 2019 Daniel "Lokathor" Gee. [offered: Zlib OR Apache-2.0 OR MIT]

### Text variant 8 of 20 (1 entries; text taken from chrono/LICENSE.txt)

```text
[Copyright line(s): see each entry below]

Rust-chrono is dual-licensed under The MIT License [1] and
Apache 2.0 License [2]. Copyright (c) 2014--2026, Kang Seonghoon and
contributors.

Nota Bene: This is same as the Rust Project's own license.

[1]: <http://opensource.org/licenses/MIT>, which is reproduced below:

~~~~
The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

[2]: <http://www.apache.org/licenses/LICENSE-2.0>, which is reproduced below:

~~~~
                              Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
~~~~
```

Entries:

- `[rust]` chrono 0.4.45 - Copyright (c) 2014, Kang Seonghoon. [offered: MIT OR Apache-2.0]

### Text variant 9 of 20 (1 entries; text taken from dom_query/LICENSE)

```text
[Copyright line(s): see each entry below]

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

This project contains portions of code and architectural concepts originally 
derived from the "nipper" project (https://github.com/importcjj/nipper), 
developed by Chen Jiaju, licensed under the MIT License and the Apache License 2.0 (dual licensed).
```

Entries:

- `[rust]` dom_query 0.27.0 - Copyright (c) 2023 Mykola Humanov

### Text variant 10 of 20 (1 entries; text taken from dpi/LICENSE-LIBM-MIT)

```text
[Copyright line(s): see each entry below]

rust-lang/libm as a whole is available for use under the MIT license:

------------------------------------------------------------------------------
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
------------------------------------------------------------------------------

This Rust library contains the following copyrights:

Portions of this software are derived from third-party works licensed under
terms compatible with the above MIT license:

* musl libc https://www.musl-libc.org/. This library contains the following
  copyright:

* The CORE-MATH project https://core-math.gitlabpages.inria.fr/. CORE-MATH
  routines are available under the MIT license on a per-file basis.

The musl libc COPYRIGHT file also includes the following notice relevant to
math portions of the library:

------------------------------------------------------------------------------
Much of the math library code (src/math/* and src/complex/*) is
and labelled as such in comments in the individual source files. All
have been licensed under extremely permissive terms.
------------------------------------------------------------------------------
```

Entries:

- `[rust]` dpi 0.1.2 - Copyright (c) 2018 Jorge Aparicio; Copyright © 2005-2020 Rich Felker, et al.; Copyright © 1993,2004 Sun Microsystems or; Copyright © 2003-2011 David Schultz or; Copyright © 2003-2009 Steven G. Kargl or [offered: Apache-2.0 AND MIT]

### Text variant 11 of 20 (1 entries; text taken from encode_unicode/LICENSE-MIT)

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE
```

Entries:

- `[rust]` encode_unicode 1.0.0 - authors: Torbjørn Birch Moltu [offered: Apache-2.0 OR MIT]

### Text variant 12 of 20 (1 entries; text taken from fax/LICENSE)

```text
[Copyright line(s): see each entry below]

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Entries:

- `[rust]` fax 0.2.7 - Copyright © 2021 The pdf-rs contributers.

### Text variant 13 of 20 (1 entries; text taken from libm/LICENSE.txt)

```text
[Copyright line(s): see each entry below]

rust-lang/libm as a whole is available for use under the MIT license:

------------------------------------------------------------------------------
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
------------------------------------------------------------------------------

As a contributor, you agree that your code can be used under either the MIT
license or the Apache-2.0 license:

------------------------------------------------------------------------------
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
------------------------------------------------------------------------------

This Rust library contains the following copyrights:

Portions of this software are derived from third-party works licensed under
terms compatible with the above MIT license:

* musl libc https://www.musl-libc.org/. This library contains the following
  copyright:

* The CORE-MATH project https://core-math.gitlabpages.inria.fr/. CORE-MATH
  routines are available under the MIT license on a per-file basis.

The musl libc COPYRIGHT file also includes the following notice relevant to
math portions of the library:

------------------------------------------------------------------------------
Much of the math library code (src/math/* and src/complex/*) is
and labelled as such in comments in the individual source files. All
have been licensed under extremely permissive terms.
------------------------------------------------------------------------------

Copyright notices are retained in src/* files where relevant.
```

Entries:

- `[rust]` libm 0.2.16 - Copyright (c) 2018 Jorge Aparicio; Copyright © 2005-2020 Rich Felker, et al.; Copyright © 1993,2004 Sun Microsystems or; Copyright © 2003-2011 David Schultz or; Copyright © 2003-2009 Steven G. Kargl or

### Text variant 14 of 20 (1 entries; text taken from loop9/LICENSE)

```text
© Kornel Lesiński

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Entries:

- `[rust]` loop9 0.1.5 - authors: Kornel

### Text variant 15 of 20 (1 entries; text taken from matrixmultiply/LICENSE-MIT)

```text
[Copyright line(s): see each entry below]

Copyirhgt (c) 2018 R. Janis Goldschmidt

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

Entries:

- `[rust]` matrixmultiply 0.3.10 - Copyright (c) 2016 - 2023 Ulrik Sverdrup "bluss"; Copyright (c) 2021 DutchGhost [constparse.rs] [offered: MIT OR Apache-2.0]

### Text variant 16 of 20 (1 entries; text taken from minisign-verify/LICENSE)

```text
[Copyright line(s): see each entry below]

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

--

Code in the src/crypto folder is derived from the rust-crypto project:
https://github.com/DaGenix/rust-crypto

Original ISC license follows:

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

Entries:

- `[rust]` minisign-verify 0.2.5 - Copyright (c) 2019-2025 Frank Denis; Copyright (c) 2006-2009 Graydon Hoare; Copyright (c) 2009-2013 Mozilla Foundation

### Text variant 17 of 20 (1 entries; text taken from ndarray/LICENSE-MIT)

```text
[Copyright line(s): see each entry below]

Jim Turner,
			  and ndarray developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

Entries:

- `[rust]` ndarray 0.16.1 - Copyright (c) 2015 - 2021 Ulrik Sverdrup "bluss", [offered: MIT OR Apache-2.0]

### Text variant 18 of 20 (1 entries; text taken from onig/LICENSE.md)

```text
# Rust-Onig is Open Source!

All source code in this repository is distributed under the terms of
the *MIT License* unless otherwise stated. The Oniguruma source code
remains the property of the original authors and is re-distributed
under the original license.

> The MIT License (MIT)
> 
> Copyright (c) 2015 Will Speak <will@willspeak.me>, Ivan Ivashchenko
> <defuz@me.com>, and contributors.
> 
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
> 
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
> 
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
```

Entries:

- `[rust]` onig 6.5.3 - authors: Will Speak, Ivan Ivashchenko

### Text variant 19 of 20 (1 entries; text taken from onig_sys/LICENSE.md)

```text
# Rust-Onig is Open Source!

All source code in this repository is distributed under the terms of
the *MIT License* unless otherwise stated. The Oniguruma source code
remains the property of the original authors and is re-distributed
under the original license, see [COPYING](oniguruma/COPYING) for more
information.

> The MIT License (MIT)
> 
> Copyright (c) 2015 Will Speak <will@willspeak.me>, Ivan Ivashchenko
> <defuz@me.com>, and contributors.
> 
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
> 
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
> 
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
```

Entries:

- `[rust]` onig_sys 69.9.3 - authors: Will Speak, Ivan Ivashchenko

### Text variant 20 of 20 (1 entries; text taken from postscript/LICENSE.md)

```text
[Copyright line(s): see each entry below]

# License

The project is dual licensed under the terms of the Apache License, Version 2.0,
and the MIT License. You may obtain copies of the two licenses at

* https://www.apache.org/licenses/LICENSE-2.0 and
* https://opensource.org/licenses/MIT, respectively.

The following two notices apply to every file of the project.

## The Apache License

\`\`\`

Licensed under the Apache License, Version 2.0 (the “License”); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an “AS IS” BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
\`\`\`

## The MIT License

\`\`\`

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
\`\`\`
```

Entries:

- `[rust]` postscript 0.14.1 - Copyright 2015–2022 The postscript Developers [offered: Apache-2.0 OR MIT]

---

## Apache License, Version 2.0 (Apache-2.0) - 15 entries

### Text variant 1 of 6 (7 entries; text taken from cpal/LICENSE)

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

Entries:

- `[rust]` cpal 0.16.0 - copyright holder not stated
- `[rust]` esaxx-rs 0.1.10 - authors: Nicolas Patry
- `[rust]` fastembed 4.9.1 - authors: Anush008, Josh Niemelä, GrisiaEvy, George MacKerron, Timon Vonk, Luya Wang, Tri, Denny Wong, Alex Rozgo
- `[rust]` hf-hub 0.4.3 - copyright holder not stated
- `[rust]` hound 3.5.1 - authors: Ruud van Asseldonk
- `[rust]` spm_precompiled 0.1.4 - authors: Nicolas Patry
- `[rust]` tokenizers 0.21.4 - authors: Anthony MOI, Nicolas Patry

### Text variant 2 of 6 (3 entries; text taken from ryu/LICENSE-APACHE)

```text
Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

Entries:

- `[rust]` ryu 1.0.23 - authors: David Tolnay [offered: Apache-2.0 OR BSL-1.0]
- `[rust]` sync_wrapper 0.1.2 - authors: Actyx AG
- `[rust]` sync_wrapper 1.0.2 - authors: Actyx AG

### Text variant 3 of 6 (2 entries; text taken from dpi/LICENSE)

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

Entries:

- `[rust]` dpi 0.1.2 - Copyright (c) 2018 Jorge Aparicio; Copyright © 2005-2020 Rich Felker, et al.; Copyright © 1993,2004 Sun Microsystems or; Copyright © 2003-2011 David Schultz or; Copyright © 2003-2009 Steven G. Kargl or [offered: Apache-2.0 AND MIT]
- `[rust]` tao 0.35.3 - authors: Tauri Programme within The Commons Conservancy, The winit contributors

### Text variant 4 of 6 (1 entries; text taken from ring/LICENSE-BoringSSL)

```text
[Copyright line(s): see each entry below]

Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

Licenses for support code
-------------------------

Parts of the TLS test suite are under the Go license. This code is not included
in BoringSSL (i.e. libcrypto and libssl) when compiled, however, so
distributing code linked against BoringSSL does not trigger this license:

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

BoringSSL uses the Chromium test infrastructure to run a continuous build,
trybots etc. The scripts which manage this, and the script for generating build
metadata, are under the Chromium license. Distributing code linked against
BoringSSL does not trigger this license.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Entries:

- `[rust]` ring 0.17.14 - Copyright (c) 2009 The Go Authors. All rights reserved.; Copyright 2015 The Chromium Authors. All rights reserved.; Copyright 2015-2025 Brian Smith. [offered: Apache-2.0 AND ISC]

### Text variant 5 of 6 (1 entries; text taken from siphasher/COPYING)

```text
[Copyright line(s): see each entry below]

Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
<LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
option.
```

Entries:

- `[rust]` siphasher 1.0.3 - Copyright 2012-2016 The Rust Project Developers.; Copyright 2016-2026 Frank Denis. [offered: MIT OR Apache-2.0]

### Text variant 6 of 6 (1 entries; text taken from zopfli/COPYING)

```text
[Copyright line(s): see each entry below]

Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

Entries:

- `[rust]` zopfli 0.8.3 - Copyright 2011 Google Inc.

---

## BSD 3-Clause License (BSD-3-Clause) - 12 entries

### Text variant 1 of 3 (9 entries; text taken from alloc-no-stdlib/LICENSE)

```text
[Copyright line(s): see each entry below]

All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Entries:

- `[rust]` alloc-no-stdlib 2.0.4 - Copyright (c) 2016 Dropbox, Inc.
- `[rust]` alloc-stdlib 0.2.4 - authors: Daniel Reiter Horn (no licence file in package)
- `[rust]` brotli 8.0.4 - Copyright (c) 2016 Dropbox, Inc.; Copyright (c) 2009, 2010, 2013-2016 by the Brotli Authors. [offered: BSD-3-Clause AND MIT]
- `[rust]` brotli-decompressor 5.0.3 - Copyright (c) 2016 Dropbox, Inc. [offered: BSD-3-Clause OR MIT]
- `[rust]` encoding_rs 0.8.35 - Copyright Mozilla Foundation; Copyright © WHATWG (Apple, Google, Mozilla, Microsoft). [offered: (Apache-2.0 OR MIT) AND BSD-3-Clause]
- `[rust]` lebe 0.5.3 - Copyright (c) 2022 Contributors to the lebe Project. All rights reserved.
- `[rust]` moxcms 0.8.1 - Copyright 2024 Radzivon Bartoshyk; Copyright (c) Radzivon Bartoshyk. All rights reserved. [offered: BSD-3-Clause OR Apache-2.0]
- `[rust]` pxfm 0.1.30 - Copyright 2024 Radzivon Bartoshyk; Copyright (c) Radzivon Bartoshyk. All rights reserved. [offered: BSD-3-Clause OR Apache-2.0]
- `[rust]` subtle 2.6.1 - Copyright (c) 2016-2017 Isis Agora Lovecruft, Henry de Valence. All rights reserved.; Copyright (c) 2016-2024 Isis Agora Lovecruft. All rights reserved.

### Text variant 2 of 3 (2 entries; text taken from avif-serialize/LICENSE)

```text
[Copyright line(s): see each entry below]

BSD 3-Clause License

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Entries:

- `[rust]` avif-serialize 0.8.9 - Copyright (c) 2020, Cloudflare, Inc.
- `[rust]` ravif 0.13.0 - Copyright (c) 2020, Kornel

### Text variant 3 of 3 (1 entries; text taken from exr/LICENSE.md)

```text
[Copyright line(s): see each entry below]

# Licenses

This Rust implementation of the OpenEXR image format
and the exrs crate are not affiliated with the 
[OpenEXR project](https://www.openexr.com/) or the 
[ACADEMY SOFTWARE FOUNDATION](https://www.aswf.io/).

## The OpenEXR Image Format: [BSD-3-Clause](https://github.com/AcademySoftwareFoundation/openexr/blob/master/LICENSE.md)

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## The `exrs` Project, and independent Rust implementation of the official OpenEXR Image Format: Also [BSD-3-Clause](https://github.com/AcademySoftwareFoundation/openexr/blob/master/LICENSE.md)

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Entries:

- `[rust]` exr 1.74.1 - Copyright (c) Contributors to the OpenEXR Project. All rights reserved.; Copyright (c) Contributors to the exrs Project. All rights reserved.

---

## BSD 2-Clause License (BSD-2-Clause) - 4 entries

### Text variant 1 of 3 (2 entries; text taken from av1-grain/LICENSE)

```text
[Copyright line(s): see each entry below]

BSD 2-Clause License

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Entries:

- `[rust]` av1-grain 0.2.5 - Copyright (c) 2022-2022, the rav1e contributors
- `[rust]` v_frame 0.3.9 - Copyright (c) 2017-2022, the rav1e contributors

### Text variant 2 of 3 (1 entries; text taken from rav1e/LICENSE)

```text
[Copyright line(s): see each entry below]

BSD 2-Clause License

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Entries:

- `[rust]` rav1e 0.8.1 - Copyright (c) 2017-2023, the rav1e contributors

### Text variant 3 of 3 (1 entries; text taken from onig_sys/oniguruma/COPYING)

```text
[Copyright line(s): see each entry below]

Oniguruma LICENSE
-----------------

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
SUCH DAMAGE.
```

Entries:

- `[native]` Oniguruma (vendored in onig_sys 69.9.3) vendored - Copyright (c) 2002-2021 K.Kosako

---

## ISC License (ISC) - 4 entries

### Text variant 1 of 3 (2 entries; text taken from rustls-webpki/LICENSE)

```text
[Copyright line(s): see each entry below]

Except as otherwise noted, this project is licensed under the following
(ISC-style) terms:

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHORS DISCLAIM ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

The files under third-party/chromium are licensed as described in
third-party/chromium/LICENSE.
```

Entries:

- `[rust]` rustls-webpki 0.101.7 - Copyright 2015 Brian Smith.
- `[rust]` rustls-webpki 0.103.13 - Copyright 2015 Brian Smith.

### Text variant 2 of 3 (1 entries; text taken from ring/LICENSE-other-bits)

```text
[Copyright line(s): see each entry below]

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Entries:

- `[rust]` ring 0.17.14 - Copyright (c) 2009 The Go Authors. All rights reserved.; Copyright 2015 The Chromium Authors. All rights reserved.; Copyright 2015-2025 Brian Smith. [offered: Apache-2.0 AND ISC]

### Text variant 3 of 3 (1 entries; text taken from untrusted/LICENSE.txt)

```text
[Copyright line(s): see each entry below]

//
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHORS DISCLAIM ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Entries:

- `[rust]` untrusted 0.9.0 - Copyright 2015-2016 Brian Smith.

---

## zlib License (Zlib) - 2 entries

### Text variant 1 of 2 (1 entries; text taken from foldhash/LICENSE)

```text
[Copyright line(s): see each entry below]

This software is provided 'as-is', without any express or implied warranty. In
no event will the authors be held liable for any damages arising from the use of
this software.

Permission is granted to anyone to use this software for any purpose, including
commercial applications, and to alter it and redistribute it freely, subject to
the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
    that you wrote the original software. If you use this software in a product,
    an acknowledgment in the product documentation would be appreciated but is
    not required.

2. Altered source versions must be plainly marked as such, and must not be
    misrepresented as being the original software.

3. This notice may not be removed or altered from any source distribution.
```

Entries:

- `[rust]` foldhash 0.2.0 - Copyright (c) 2024 Orson Peters

### Text variant 2 of 2 (1 entries; text taken from zlib-rs/LICENSE)

```text
(C) 2024 Trifecta Tech Foundation 

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.

2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.

3. This notice may not be removed or altered from any source distribution.
```

Entries:

- `[rust]` zlib-rs 0.6.8 - copyright holder not stated

---

## The Unlicense (Unlicense) - 2 entries

### Text (2 entries; taken from whisper-rs/LICENSE)

```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
```

Entries:

- `[rust]` whisper-rs 0.14.4 - copyright holder not stated
- `[rust]` whisper-rs-sys 0.13.1 - copyright holder not stated (no licence file in package)

---

## CC0 1.0 Universal (CC0-1.0) - 2 entries

### Text (2 entries; taken from dunce/LICENSE)

```text
Creative Commons Legal Code

CC0 1.0 Universal

    CREATIVE COMMONS CORPORATION IS NOT A LAW FIRM AND DOES NOT PROVIDE
    LEGAL SERVICES. DISTRIBUTION OF THIS DOCUMENT DOES NOT CREATE AN
    ATTORNEY-CLIENT RELATIONSHIP. CREATIVE COMMONS PROVIDES THIS
    INFORMATION ON AN "AS-IS" BASIS. CREATIVE COMMONS MAKES NO WARRANTIES
    REGARDING THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS
    PROVIDED HEREUNDER, AND DISCLAIMS LIABILITY FOR DAMAGES RESULTING FROM
    THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS PROVIDED
    HEREUNDER.

Statement of Purpose

The laws of most jurisdictions throughout the world automatically confer
exclusive Copyright and Related Rights (defined below) upon the creator
and subsequent owner(s) (each and all, an "owner") of an original work of
authorship and/or a database (each, a "Work").

Certain owners wish to permanently relinquish those rights to a Work for
the purpose of contributing to a commons of creative, cultural and
scientific works ("Commons") that the public can reliably and without fear
of later claims of infringement build upon, modify, incorporate in other
works, reuse and redistribute as freely as possible in any form whatsoever
and for any purposes, including without limitation commercial purposes.
These owners may contribute to the Commons to promote the ideal of a free
culture and the further production of creative, cultural and scientific
works, or to gain reputation or greater distribution for their Work in
part through the use and efforts of others.

For these and/or other purposes and motivations, and without any
expectation of additional consideration or compensation, the person
associating CC0 with a Work (the "Affirmer"), to the extent that he or she
is an owner of Copyright and Related Rights in the Work, voluntarily
elects to apply CC0 to the Work and publicly distribute the Work under its
terms, with knowledge of his or her Copyright and Related Rights in the
Work and the meaning and intended legal effect of CC0 on those rights.

1. Copyright and Related Rights. A Work made available under CC0 may be
protected by copyright and related or neighboring rights ("Copyright and
Related Rights"). Copyright and Related Rights include, but are not
limited to, the following:

  i. the right to reproduce, adapt, distribute, perform, display,
     communicate, and translate a Work;
 ii. moral rights retained by the original author(s) and/or performer(s);
iii. publicity and privacy rights pertaining to a person's image or
     likeness depicted in a Work;
 iv. rights protecting against unfair competition in regards to a Work,
     subject to the limitations in paragraph 4(a), below;
  v. rights protecting the extraction, dissemination, use and reuse of data
     in a Work;
 vi. database rights (such as those arising under Directive 96/9/EC of the
     European Parliament and of the Council of 11 March 1996 on the legal
     protection of databases, and under any national implementation
     thereof, including any amended or successor version of such
     directive); and
vii. other similar, equivalent or corresponding rights throughout the
     world based on applicable law or treaty, and any national
     implementations thereof.

2. Waiver. To the greatest extent permitted by, but not in contravention
of, applicable law, Affirmer hereby overtly, fully, permanently,
irrevocably and unconditionally waives, abandons, and surrenders all of
Affirmer's Copyright and Related Rights and associated claims and causes
of action, whether now known or unknown (including existing as well as
future claims and causes of action), in the Work (i) in all territories
worldwide, (ii) for the maximum duration provided by applicable law or
treaty (including future time extensions), (iii) in any current or future
medium and for any number of copies, and (iv) for any purpose whatsoever,
including without limitation commercial, advertising or promotional
purposes (the "Waiver"). Affirmer makes the Waiver for the benefit of each
member of the public at large and to the detriment of Affirmer's heirs and
successors, fully intending that such Waiver shall not be subject to
revocation, rescission, cancellation, termination, or any other legal or
equitable action to disrupt the quiet enjoyment of the Work by the public
as contemplated by Affirmer's express Statement of Purpose.

3. Public License Fallback. Should any part of the Waiver for any reason
be judged legally invalid or ineffective under applicable law, then the
Waiver shall be preserved to the maximum extent permitted taking into
account Affirmer's express Statement of Purpose. In addition, to the
extent the Waiver is so judged Affirmer hereby grants to each affected
person a royalty-free, non transferable, non sublicensable, non exclusive,
irrevocable and unconditional license to exercise Affirmer's Copyright and
Related Rights in the Work (i) in all territories worldwide, (ii) for the
maximum duration provided by applicable law or treaty (including future
time extensions), (iii) in any current or future medium and for any number
of copies, and (iv) for any purpose whatsoever, including without
limitation commercial, advertising or promotional purposes (the
"License"). The License shall be deemed effective as of the date CC0 was
applied by Affirmer to the Work. Should any part of the License for any
reason be judged legally invalid or ineffective under applicable law, such
partial invalidity or ineffectiveness shall not invalidate the remainder
of the License, and in such case Affirmer hereby affirms that he or she
will not (i) exercise any of his or her remaining Copyright and Related
Rights in the Work or (ii) assert any associated claims and causes of
action with respect to the Work, in either case contrary to Affirmer's
express Statement of Purpose.

4. Limitations and Disclaimers.

 a. No trademark or patent rights held by Affirmer are waived, abandoned,
    surrendered, licensed or otherwise affected by this document.
 b. Affirmer offers the Work as-is and makes no representations or
    warranties of any kind concerning the Work, express, implied,
    statutory or otherwise, including without limitation warranties of
    title, merchantability, fitness for a particular purpose, non
    infringement, or the absence of latent or other defects, accuracy, or
    the present or absence of errors, whether or not discoverable, all to
    the greatest extent permissible under applicable law.
 c. Affirmer disclaims responsibility for clearing rights of other persons
    that may apply to the Work or any use thereof, including without
    limitation any person's Copyright and Related Rights in the Work.
    Further, Affirmer disclaims responsibility for obtaining any necessary
    consents, permissions or other rights required for any use of the
    Work.
 d. Affirmer understands and acknowledges that Creative Commons is not a
    party to this document and has no duty or obligation with respect to
    this CC0 or use of the Work.
```

Entries:

- `[rust]` dunce 1.0.5 - authors: Kornel [offered: CC0-1.0 OR MIT-0 OR Apache-2.0]
- `[rust]` imgref 1.12.2 - authors: Kornel Lesiński [offered: CC0-1.0 OR Apache-2.0]

---

## Mozilla Public License 2.0 (MPL-2.0) - 5 entries

### Text variant 1 of 2 (4 entries; text taken from cssparser/LICENSE)

```text
Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in 
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
```

Entries:

- `[rust]` cssparser 0.36.0 - authors: Simon Sapin
- `[rust]` dtoa-short 0.3.5 - authors: Xidorn Quan
- `[rust]` selectors 0.36.1 - authors: The Servo Project Developers (no licence file in package)
- `[rust]` webpki-roots 0.25.4 - copyright holder not stated (no licence file in package)

### Text variant 2 of 2 (1 entries; text taken from option-ext/LICENSE.txt)

```text
Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in 
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at https://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
```

Entries:

- `[rust]` option-ext 0.2.0 - authors: Simon Ochsenreither

---

## Unicode License v3 (Unicode-3.0) - 16 entries

### Text variant 1 of 2 (15 entries; text taken from icu_collections/LICENSE)

```text
[Copyright line(s): see each entry below]

UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0

—

Portions of ICU4X may have been adapted from ICU4C and/or ICU4J.
ICU 1.8.1 to ICU 57.1 © 1995-2016 International Business Machines Corporation and others.
```

Entries:

- `[rust]` icu_collections 2.2.0 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` icu_locale_core 2.2.0 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` icu_normalizer 2.2.0 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` icu_normalizer_data 2.2.0 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` icu_properties 2.2.0 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` icu_properties_data 2.2.0 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` icu_provider 2.2.0 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` litemap 0.8.2 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` potential_utf 0.1.5 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` tinystr 0.8.3 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` writeable 0.6.3 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` yoke 0.8.3 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` zerofrom 0.1.8 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` zerotrie 0.2.4 - Copyright © 2020-2024 Unicode, Inc.
- `[rust]` zerovec 0.11.6 - Copyright © 2020-2024 Unicode, Inc.

### Text variant 2 of 2 (1 entries; text taken from unicode-ident/LICENSE-UNICODE)

```text
[Copyright line(s): see each entry below]

UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```

Entries:

- `[rust]` unicode-ident 1.0.24 - Copyright © 1991-2023 Unicode, Inc. [offered: (MIT OR Apache-2.0) AND Unicode-3.0]

---

## Community Data License Agreement - Permissive 2.0 (CDLA-Permissive-2.0) - 2 entries

### Text (2 entries; taken from webpki-roots/LICENSE)

```text
# Community Data License Agreement - Permissive - Version 2.0

This is the Community Data License Agreement - Permissive, Version
2.0 (the "agreement"). Data Provider(s) and Data Recipient(s) agree
as follows:

## 1. Provision of the Data

1.1. A Data Recipient may use, modify, and share the Data made
available by Data Provider(s) under this agreement if that Data
Recipient follows the terms of this agreement.

1.2. This agreement does not impose any restriction on a Data
Recipient's use, modification, or sharing of any portions of the
Data that are in the public domain or that may be used, modified,
or shared under any other legal exception or limitation.

## 2. Conditions for Sharing Data

2.1. A Data Recipient may share Data, with or without modifications, so
long as the Data Recipient makes available the text of this agreement
with the shared Data.

## 3. No Restrictions on Results

3.1. This agreement does not impose any restriction or obligations
with respect to the use, modification, or sharing of Results.

## 4. No Warranty; Limitation of Liability

4.1. All Data Recipients receive the Data subject to the following
terms:

THE DATA IS PROVIDED ON AN "AS IS" BASIS, WITHOUT REPRESENTATIONS,
WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR IMPLIED
INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR CONDITIONS OF TITLE,
NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

NO DATA PROVIDER SHALL HAVE ANY LIABILITY FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING
WITHOUT LIMITATION LOST PROFITS), HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE DATA OR RESULTS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

## 5. Definitions

5.1. "Data" means the material received by a Data Recipient under
this agreement.

5.2. "Data Provider" means any person who is the source of Data
provided under this agreement and in reliance on a Data Recipient's
agreement to its terms.

5.3. "Data Recipient" means any person who receives Data directly
or indirectly from a Data Provider and agrees to the terms of this
agreement.

5.4. "Results" means any outcome obtained by computational analysis
of Data, including for example machine learning models and models'
insights.
```

Entries:

- `[rust]` webpki-roots 0.26.11 - copyright holder not stated
- `[rust]` webpki-roots 1.0.9 - copyright holder not stated

---

## SIL Open Font License 1.1 (OFL-1.1) - 3 entries

### Text variant 1 of 3 (1 entries; text taken from google/fonts ofl/manrope/OFL.txt)

```text
[Copyright line(s): see each entry below]

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

Entries:

- `[font]` Manrope (weights 400-800, woff2) - Copyright 2018 The Manrope Project Authors (https://github.com/googlefonts/manrope)

### Text variant 2 of 3 (1 entries; text taken from JetBrains/JetBrainsMono OFL.txt)

```text
[Copyright line(s): see each entry below]

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

Entries:

- `[font]` JetBrains Mono (weights 400/500/600, woff2) - Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

### Text variant 3 of 3 (1 entries; text taken from google/fonts ofl/michroma/OFL.txt)

```text
[Copyright line(s): see each entry below]

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

Entries:

- `[font]` Michroma (weight 400, latin woff2) - Copyright 2011 The Michroma Project Authors (https://github.com/googlefonts/Michroma-font)

---

## Appendix A - ring 0.17.14 licence files (verbatim)

### ring/LICENSE

```text
*ring* uses an "ISC" license, like BoringSSL used to use, for new code
files. See LICENSE-other-bits for the text of that license.

See LICENSE-BoringSSL for code that was sourced from BoringSSL under the
Apache 2.0 license. Some code that was sourced from BoringSSL under the ISC
license. In each case, the license info is at the top of the file.

See src/polyfill/once_cell/LICENSE-APACHE and src/polyfill/once_cell/LICENSE-MIT
for the license to code that was sourced from the once_cell project.
```

### ring/LICENSE-other-bits

```text
Copyright 2015-2025 Brian Smith.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### ring/LICENSE-BoringSSL

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.


Licenses for support code
-------------------------

Parts of the TLS test suite are under the Go license. This code is not included
in BoringSSL (i.e. libcrypto and libssl) when compiled, however, so
distributing code linked against BoringSSL does not trigger this license:

Copyright (c) 2009 The Go Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


BoringSSL uses the Chromium test infrastructure to run a continuous build,
trybots etc. The scripts which manage this, and the script for generating build
metadata, are under the Chromium license. Distributing code linked against
BoringSSL does not trigger this license.

Copyright 2015 The Chromium Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Appendix B - rav1e 0.8.1 PATENTS (verbatim)

```text
Alliance for Open Media Patent License 1.0

1. License Terms.

1.1. Patent License. Subject to the terms and conditions of this License, each
     Licensor, on behalf of itself and successors in interest and assigns,
     grants Licensee a non-sublicensable, perpetual, worldwide, non-exclusive,
     no-charge, royalty-free, irrevocable (except as expressly stated in this
     License) patent license to its Necessary Claims to make, use, sell, offer
     for sale, import or distribute any Implementation.

1.2. Conditions.

1.2.1. Availability. As a condition to the grant of rights to Licensee to make,
       sell, offer for sale, import or distribute an Implementation under
       Section 1.1, Licensee must make its Necessary Claims available under
       this License, and must reproduce this License with any Implementation
       as follows:

       a. For distribution in source code, by including this License in the
          root directory of the source code with its Implementation.

       b. For distribution in any other form (including binary, object form,
          and/or hardware description code (e.g., HDL, RTL, Gate Level Netlist,
          GDSII, etc.)), by including this License in the documentation, legal
          notices, and/or other written materials provided with the
          Implementation.

1.2.2. Additional Conditions. This license is directly from Licensor to
       Licensee.  Licensee acknowledges as a condition of benefiting from it
       that no rights from Licensor are received from suppliers, distributors,
       or otherwise in connection with this License.

1.3. Defensive Termination. If any Licensee, its Affiliates, or its agents
     initiates patent litigation or files, maintains, or voluntarily
     participates in a lawsuit against another entity or any person asserting
     that any Implementation infringes Necessary Claims, any patent licenses
     granted under this License directly to the Licensee are immediately
     terminated as of the date of the initiation of action unless 1) that suit
     was in response to a corresponding suit regarding an Implementation first
     brought against an initiating entity, or 2) that suit was brought to
     enforce the terms of this License (including intervention in a third-party
     action by a Licensee).

1.4. Disclaimers. The Reference Implementation and Specification are provided
     "AS IS" and without warranty. The entire risk as to implementing or
     otherwise using the Reference Implementation or Specification is assumed
     by the implementer and user. Licensor expressly disclaims any warranties
     (express, implied, or otherwise), including implied warranties of
     merchantability, non-infringement, fitness for a particular purpose, or
     title, related to the material. IN NO EVENT WILL LICENSOR BE LIABLE TO
     ANY OTHER PARTY FOR LOST PROFITS OR ANY FORM OF INDIRECT, SPECIAL,
     INCIDENTAL, OR CONSEQUENTIAL DAMAGES OF ANY CHARACTER FROM ANY CAUSES OF
     ACTION OF ANY KIND WITH RESPECT TO THIS LICENSE, WHETHER BASED ON BREACH
     OF CONTRACT, TORT (INCLUDING NEGLIGENCE), OR OTHERWISE, AND WHETHER OR
     NOT THE OTHER PARTRY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

2. Definitions.

2.1. Affiliate.  �Affiliate� means an entity that directly or indirectly
     Controls, is Controlled by, or is under common Control of that party.

2.2. Control. �Control� means direct or indirect control of more than 50% of
     the voting power to elect directors of that corporation, or for any other
     entity, the power to direct management of such entity.

2.3. Decoder.  "Decoder" means any decoder that conforms fully with all
     non-optional portions of the Specification.

2.4. Encoder.  "Encoder" means any encoder that produces a bitstream that can
     be decoded by a Decoder only to the extent it produces such a bitstream.

2.5. Final Deliverable.  �Final Deliverable� means the final version of a
     deliverable approved by the Alliance for Open Media as a Final
     Deliverable.

2.6. Implementation.  "Implementation" means any implementation, including the
     Reference Implementation, that is an Encoder and/or a Decoder. An
     Implementation also includes components of an Implementation only to the
     extent they are used as part of an Implementation.

2.7. License. �License� means this license.

2.8. Licensee. �Licensee� means any person or entity who exercises patent
     rights granted under this License.

2.9. Licensor.  "Licensor" means (i) any Licensee that makes, sells, offers
     for sale, imports or distributes any Implementation, or (ii) a person
     or entity that has a licensing obligation to the Implementation as a
     result of its membership and/or participation in the Alliance for Open
     Media working group that developed the Specification.

2.10. Necessary Claims.  "Necessary Claims" means all claims of patents or
      patent applications, (a) that currently or at any time in the future,
      are owned or controlled by the Licensor, and (b) (i) would be an
      Essential Claim as defined by the W3C Policy as of February 5, 2004
      (https://www.w3.org/Consortium/Patent-Policy-20040205/#def-essential)
      as if the Specification was a W3C Recommendation; or (ii) are infringed
      by the Reference Implementation.

2.11. Reference Implementation. �Reference Implementation� means an Encoder
      and/or Decoder released by the Alliance for Open Media as a Final
      Deliverable.

2.12. Specification. �Specification� means the specification designated by
      the Alliance for Open Media as a Final Deliverable for which this
      License was issued.
```

## Appendix C - Hugging Face / upstream sources for downloaded models

Models are not shipped in the installer; they are fetched on first run from the URLs listed in `third-party-inventory.json` (`models` array). The licence text for each is the MIT text above (Whisper, Silero VAD, bge-small-en-v1.5) as declared by the upstream project or model card.
