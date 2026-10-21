# CMS operations

How editors work with the BIBO Bay content in Sanity Studio, and what each setting does on the
site. Everything here describes the code as it is today.

## The Studio

The Studio is a standalone Sanity app in `studio/`, installed separately from the website:

```bash
npm --prefix studio ci
SANITY_STUDIO_PROJECT_ID=<project id> SANITY_STUDIO_DATASET=production npm --prefix studio run dev
```

- `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET` are required; the Studio refuses to start
  without them. Never put a token in a `SANITY_STUDIO_*` variable: those values reach the browser.
- `SANITY_STUDIO_PREVIEW_URL` (optional, https or `http://localhost`) turns on the Presentation tool.
- `npm --prefix studio run build` builds it; deploying it to Sanity hosting is done by the BIBO Bay
  owner account, not by CI.
- `npm --prefix studio run seed -- --dry-run` lists the 33 claim-safe starter documents. Without
  `--dry-run`, and with a server-only `SANITY_WRITE_TOKEN`, it creates the missing ones with
  `createIfNotExists`: it never overwrites an editor's changes.

## The live project

Live since 2026-10-21 under the BIBO Bay owner account:

| What | Value |
|---|---|
| Studio | https://bibobay.sanity.studio (sign in with the BIBO Bay account); `/studio` on the site redirects there |
| Project and dataset | `k82r18ol`, `production` (public, so the site reads published content without a token) |
| Website | https://www.bibobay.com: publishing refreshes it through the webhook (see "Publishing and when the site updates") |
| CORS origins | `http://localhost:3333` (local Studio, with credentials); `http://localhost:3000`, `https://www.bibobay.com` and the Vercel preview origin, without credentials (the site reads Sanity only on its server) |

After a schema change, redeploy the Studio from `studio/`:

```bash
SANITY_STUDIO_PROJECT_ID=k82r18ol SANITY_STUDIO_DATASET=production SANITY_STUDIO_PREVIEW_URL=https://www.bibobay.com npx sanity deploy
```

`studio/sanity.cli.ts` names the hosted Studio (`deployment.appId`), so the deploy replaces it without
asking, and turns on Sanity's auto-updates. The deploy also uploads the schema. Leave out
`SANITY_STUDIO_PREVIEW_URL` and the deployed Studio loses its Presentation tool.

## What is in the Studio

Four singletons sit at the top of the desk (fixed IDs; a second copy cannot be created):

| Document | ID | Holds |
|---|---|---|
| Site settings | `siteSettings` | Title, description, verified canonical URL, default SEO, feature toggles, contact email, Studio URL, social links, navigation, footer |
| Landing page | `landingPage` | Section order and visibility, page SEO, the copy of every section, and references to the collections |
| Legal and consent | `legalSettings` | Privacy text, terms text, their version dates, the consent-copy version, and the order form's consent sentence with its version |
| Contact page | `contactPage` | The heading, intro, search title and description, button label, success, error and closed messages and the line above the contact email for `/contact` |

Collections:

| Type | Used on the site |
|---|---|
| `character` (Bay friend) | Friends section; `status` `concept` shows a "Concept" stamp |
| `episodePreview` (Story preview) | Story ideas section; a media link shows only when `status` is `published` and the URL is https |
| `brandPillar` (BIBO value) | Values section |
| `ecosystemEntry` (Wider BIBO vision) | Wider-world index; its call to action shows only when `status` is `available` |
| `testimonial` (Verified experience) | Only when `testimonialsEnabled` is on and the entry is marked verified |
| `faqItem` | FAQ section |
| `leadMagnet` (Download) | A download link in the signup section, only when real (see below) |
| `productCategory`, `product` | Shown on `/shop` and `/shop/<slug>` only while commerce is on (Task 7b). A `listed` product appears in the catalogue, grouped under its category (categories in their `order`); a `sold-out` product keeps its own page, marked sold out, with no way to add it; a `draft` has no page. Each product shows its first picture in the catalogue and all of them on its page, with the alt text you give; its SEO title and description head its page, and "no index" keeps it out of search results and the sitemap. No price is ever shown. An order request reloads each listed product and stores its name, SKU, variant and pack as they are at that moment (Task 7a). |

## Feature toggles (site settings)

| Toggle | Default | Effect today |
|---|---|---|
| `commerceEnabled` | `false` | Adds the shop link (labelled with the navigation's shop label) to the header and footer, opens `/shop` and the product pages (Task 7b), lists them in the sitemap, switches the privacy and terms fallback text to its order-request version, and opens the order page `/order` and the order API (`/api/orders`) (Task 7c). Staff can manage orders from `/admin/orders` (Task 8c), but the whole flow has not been tried end to end on a live preview with real staff accounts and mail (Task 12), so leave it off until that pass is done. |
| `trackingEnabled` | `false` | With commerce on, opens the tracking page `/track`, the private order links `/orders/<token>` and the tracking API (`/api/orders/track`), adds "Track an order" to the footer, and shows a new order's private link on the order page (Task 7c). |
| `orderCountries` | empty | The countries the order form offers, as two-letter ISO 3166-1 codes in capitals (`GB`, `PH`, `AU`). Empty means every country. The server refuses an order for any other country. The team quotes delivery for each order, so listing a country promises nothing about it. |
| `testimonialsEnabled` | `false` | Allows the testimonials section to render, and then only entries marked verified. |
| `canonicalUrlVerified` | `false` | The canonical URL is used (canonical tags, sitemap, structured data) only when this is on. Turn it on only after the domain is verified. |

The repository fallback content uses the same defaults, so the site is safe when Sanity is down.

Other site settings: a **social link** renders only when marked verified and its URL is on that
platform's own domain. The **contact email** shows in the footer and on the privacy page only when
set. The **Studio URL** makes `/studio` redirect there (https only).

## Section order and visibility

`landingPage.sections` is the list of sections in page order, each with `visible` and an optional
colour theme (`paper`, `sea`, `sand`, `navy`; accent `teal`, `yellow`, `orange`, `purple`).

- Drag to reorder. Each section may appear once.
- Untick `visible` to hide a section. **A section left out of the list is hidden too**: an editor's
  list is authoritative. Only a missing or broken list falls back to the default order.
- A section with nothing to show hides itself (for example, no FAQ items).
- If the hero is hidden, the page still keeps one level-one heading (the site title, for screen readers).
- Header links (and the header's main button) that point at a hidden section, or at the shop while
  commerce is off, are dropped automatically. Footer links are shown as entered, so keep them to
  pages that exist (`/privacy`, `/terms`).

Every visible sentence on the landing page comes from Sanity. Interface labels that are not
content (for example "Menu", status stamps) live in `components/landing/ui-copy.ts`. An empty
eyebrow renders nothing.

## Images

- Every image field uses "Image with alt text": describe the image, or tick **Decorative only**
  (then it gets an empty `alt`). The Studio refuses an image with neither.
- Set the crop and **hotspot** in the image editor. The site applies the crop and keeps the hotspot
  in view when a frame cuts the image further.
- When an image is absent, the slot shows the repository's channel art instead: stills cut from the
  Bibo Bay channel's own videos (`public/brand/art/`, registered in `lib/content/brand-art.ts`). A
  friend gets a portrait only when their first name is Tula, Bob or Lumi; a video gets its
  thumbnail when its media link is a YouTube link to one of the channel's videos; the section scenes
  (hero, promise, loop, values, signup, closing) always have one. Upload an image to replace a
  slot's channel art; it cannot be switched off from the Studio. A slot with neither keeps its drawn
  placeholder. The hero's **Artwork description** names only that drawn scene; channel art and an
  uploaded image carry their own alt text, so today the field does not appear on the page.
- Editors' images are served from Sanity's CDN (`cdn.sanity.io`), the only image host the site
  allows. Channel art is served by the site itself.

## Downloads (lead magnets)

The signup section shows a download card only when the referenced `leadMagnet` has
**File exists and may be offered** ticked **and** a verified file URL: an https file (public at its
own address, so the signup gate does not protect it), or a repository PDF named `/freebies/<name>.pdf`,
which lives in `content/freebies` and is offered only through the signed download after a signup. The Studio will not let you tick the box without a URL. Never
tick it for a file that does not exist yet: the page would then promise it.

The seeded download is the **Bibo Bay Activity Pack** (`/freebies/bibo-bay-activity-pack.pdf`):
eight printable pages built from the site's own copy and the channel's stills, offered only after
the visitor joins the founding-family list (ruling R140). The file lives in `content/freebies/`, not
in `public/`, so it has no address on the site: it is served only by the signed route
`/api/freebies/download?t=...`, with a link that the signup answer (24 hours) and the acknowledgement
email (30 days) carry. `/freebies/*.pdf` in the CMS is therefore the identity of a repository file,
not an address a browser can open; opening it directly answers 404. For that file the card also
shows renders of its pages and its real size; any other file shows its title and description only.
Removing the reference from the signup section removes the card.

A dataset seeded before 2026-10-16 keeps the old lead description and button label ("...with no
sign-up", "Join the list"), because seeding creates only missing documents; edit the lead section by hand.

The acknowledgement email carries the signed link once the site's public address is known (a verified
canonical URL in Site settings, or `NEXT_PUBLIC_APP_URL`); until then it leaves the download out
rather than send a link that cannot open from an inbox.

To change the pack, edit `scripts/freebie/build_activity_pack.py` (or the site copy it reads) and
run `uv run scripts/freebie/build_activity_pack.py` from the repository root. It rewrites the PDF (in `content/freebies/`),
its page previews and `lib/content/activity-pack.manifest.json`; `tests/freebie` checks that the
three still agree, and that every link and QR code in the PDF goes to the channel or one of its
videos. The build is reproducible: the fonts are pinned to a google/fonts commit and checked by
sha256, Python is pinned to 3.12 (zlib, and so the PDF's compressed bytes, differ between Python
versions) and the packages are locked in `build_activity_pack.py.lock`, so the same inputs give the
same bytes. After changing the dependency list, run `uv lock --script
scripts/freebie/build_activity_pack.py`.

## Tab sections: one long text makes every panel tall

The Bay friends and Story ideas selectors stack every panel in the same place so switching tabs
never moves the page. The block is therefore as tall as the **tallest** panel: a very long
description on one friend makes the box for every friend that tall. Keep descriptions of similar
length.

## Contact page

The Contact page document (`contactPage`) holds the words of `/contact`. Field labels, hints, error
texts under the fields and the topic names are fixed in the code, like the signup form's; everything
below is yours to edit:

- **Heading, intro, search title and description.** Write the intro for parents, carers and
  professionals, and ask people to leave out details about a child.
- **Button label, success message, error message.** The success message must say the message was
  received. The Studio refuses one that says it was sent, emailed or delivered, or tells people to
  check their inbox, because nothing is emailed to the sender; if such text gets published anyway, the
  site shows the built-in text instead.
- **Closed message.** Shown instead of the form when the form is not open and no contact email is set
  (and if the form closes while someone is writing).
- **Line above the contact email.** Shown, with the address from Site settings (Verified public contact
  email) as a mailto link, when the form is not open but an address is set.
- **Footer link label** (Site settings, footer: Contact page link label, `contactPageLabel`). Optional;
  the fallback is "Contact us". The link appears in the footer only while the form is open.

The form itself opens only when Supabase, email sending, the staff notification address and the
address-hash secret are all configured ([deployment.md](deployment.md#contact-form)); editing this
document never opens or closes it. The page is listed for search engines while it offers a way to reach
the team (the open form or a contact email), unless its SEO is set to "no index".

In **Presentation** (see [Live editing](#live-editing-presentation)) `/contact` opens beside this
document: the heading, intro, button label, footer link and the closed message or the line above the
address are click-to-edit like any other page text. The success and error messages appear only after
someone submits the form, so edit them in the form fields. Do not submit test messages from the
preview: it is the live site, so each one is stored and alerts the team.

After a schema change, redeploy the Studio from `studio/` (see [The live project](#the-live-project)),
then publish the document. `npm --prefix studio run seed` creates the document if it is missing
and never overwrites an editor's changes.

## Legal text, consent version and indexing

- `/privacy` and `/terms` show the Sanity text when present. Without it they show the repository's
  plain-language fallback under a "not yet reviewed by a lawyer" note.
- A legal page is indexed by search engines only when its Sanity text **and** its version date
  (`privacyVersion` or `termsVersion`) are set. Until both pages have reviewed, versioned text,
  `/api/readiness` reports `legalReviewed: false`. Have counsel review the text before setting a version.
- `consentCopyVersion` is stored with each signup as the version of the consent wording the person
  agreed to. Change it whenever the consent sentence in the signup section changes. It must be a
  short token (letters, digits, `.`, `_`, `:`, `-`; at most 40 characters); anything else makes the
  server store the fallback version `1` and log a warning.
- `orderConsentCopy` is the sentence a buyer ticks on the order form, and `orderConsentCopyVersion`
  is stored with each order as its version (same token rules). Set both or neither: leaving either
  empty, or giving a version the server cannot store, shows the site's built-in order sentence and
  records its version (`order-1`) instead, so an order never records a version for words the buyer
  did not see. Change the version whenever you change the sentence.

## Preview (draft mode)

### Live editing (Presentation)

Open **Presentation** in the Studio (https://bibobay.sanity.studio): the site appears beside the
editing form, showing your unpublished changes.

- **Click to edit.** Hover any text on the page: an outline names the field it comes from. Click it
  and the Studio opens that document at that field.
- **Live.** Type in the form and the page follows within a second or two, before you publish.
  Visitors keep seeing the published site until you press **Publish**.
- **Navigate either way.** Follow a link on the page and the Studio's address bar follows; type a
  path in the address bar (`/privacy`) and the page goes there. The **Documents on this page** list
  shows what the page is built from.
- **Perspective.** The switch at the top of Presentation shows drafts (the default), the published
  site, or a release with its drafts.
- Images, switches (section visibility, colour themes) and links have no outline: edit them in the
  form; the page still updates live.
- The "draft preview" notice stays at the top of the page; its "Exit preview" link is hidden inside
  the Studio and shown when the preview is opened in its own tab.

### How it works

`/api/draft-mode/enable` checks the Presentation tool's short-lived secret with the server-only
`SANITY_API_READ_TOKEN` (Viewer role), then shows drafts with the "draft preview" notice and
`noindex`; `/api/draft-mode/disable` exits. `presentationTool` in `studio/sanity.config.ts` uses
`previewUrl: { initial, previewMode: { enable: "/api/draft-mode/enable" } }`, with the site URL from
`SANITY_STUDIO_PREVIEW_URL`; the hosted Studio is built with `SANITY_STUDIO_PREVIEW_URL=https://www.bibobay.com`,
and the site has `SANITY_API_READ_TOKEN` and `SANITY_STUDIO_ORIGIN=https://bibobay.sanity.studio`.
Without `SANITY_STUDIO_PREVIEW_URL` the Studio has no Presentation tool at all.

- Draft reads ask Sanity for content source maps, which hide the click-to-edit link in each text as
  invisible characters. Only draft-mode requests do this, and only when `SANITY_STUDIO_ORIGIN` names
  the Studio. The site cleans every value it decides with (ids, links, colours, versions) and
  everything it puts in `<head>`; text keeps the link (`lib/content/stega.ts`).
- The overlay code (`@sanity/visual-editing`) is a separate download that only a draft page inside the
  Studio requests; visitors never load it. Its styles carry the page's CSP nonce (copied in the browser
  from Next's own scripts), and an error boundary keeps the page if the overlay ever fails.
- The site never puts an edit link in an attribute (an `aria-label` would read it aloud); text the
  site splits for display, such as the hero title's lines, carries it once on the whole element, so
  the whole heading is clickable.
- Each saved edit makes the page re-render on the server with the latest draft.
- Inside the Studio's frame the draft cookies are set `Partitioned`, so browsers that block
  third-party cookies (Safari) keep the preview.
- The hosted Studio opens inside the Sanity Dashboard (`https://www.sanity.io`), so the site's CSP
  `frame-ancestors` lists both the Studio and the Dashboard.

## Publishing and when the site updates

Published content is cached by the site and expired by a signed webhook:

1. The live project has this webhook (Sanity, project settings, API, webhooks: "Website cache
   refresh"): URL `https://www.bibobay.com/api/revalidate`, method POST, on create, update and
   delete of every document, projection `{_type, _id}`, secret = the site's
   `SANITY_REVALIDATE_SECRET`. A new site needs the same webhook with its own URL.
2. On publish, the site expires the cache tag for that document type, and the next visitor sees the
   change. Publishing a download (`leadMagnet`) refreshes the landing page.
3. The site caches published content with no time limit, except the two commerce switches
   (`commerceEnabled`, `trackingEnabled`), which the server gates also re-read at least every 300
   seconds, so switching commerce off reaches the order routes within five minutes even if the
   webhook is broken (ruling R127). The rest of that cache persists across deployments
   (the Next.js `fetch` Data Cache), so a redeploy does not refresh it. Without the webhook (or the
   secret), published changes do not appear until the webhook is set up and the document is
   published again; `/api/readiness` reports `revalidation: false` meanwhile.
