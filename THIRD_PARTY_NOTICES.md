# Third-party notices

The project itself is currently unlicensed pending owner approval. References
to third-party licences below do not grant a licence to this implementation.

This implementation follows integration patterns from Adobe's
[Commerce Checkout Starter Kit](https://github.com/adobe/commerce-checkout-starter-kit)
and [Commerce SDK](https://github.com/adobe/aio-commerce-sdk).
Those projects are licensed under Apache License 2.0. Their respective copyright
and license notices remain applicable to their packages and any reused material.
The local extension is newly authored implementation code using those APIs;
the starter's demo payment validation is not used as real payment validation.

Adobe, Adobe Commerce, App Builder, Azupay, PayID and PayTo names belong to their
respective owners. This project is not endorsed or certified by them.

Dependency licenses are distributed with their installed packages. See
`package-lock.json` for the pinned dependency graph. No Azupay API keys or private
merchant documentation are included.

The self-contained EDS installer bundles the Acorn JavaScript parser, licensed
under the MIT License. Its original license is included in the installer
archive as `ACORN-LICENSE.txt`.

PayID and PayTo marks belong to Australian Payments Plus and its relevant
entities. This extension references public official brand-portal asset URLs;
it does not redistribute the artwork. Merchants must obtain the required
permission through AP+ or their payment provider and follow the current brand
guidelines before enabling logo display.

The organization of the merchant installation guide was informed by Stripe's
public App Builder documentation. No Stripe documentation text, screenshots,
PDF, source code or branding is bundled with this project.
