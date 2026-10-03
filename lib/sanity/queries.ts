// Fixed singleton IDs; never query the first document by _type alone.
export const SITE_SETTINGS_QUERY = '*[_id == "siteSettings"][0]{...}';
export const LEGAL_SETTINGS_QUERY = '*[_id == "legalSettings"][0]{...}';
export const LANDING_PAGE_QUERY = `*[_id == "landingPage"][0]{
  ...,
  "characters": characters[]->,
  "episodes": episodes[]->,
  "pillars": pillars[]->,
  "ecosystem": ecosystem[]->,
  "testimonials": testimonials[]->,
  "faqs": faqs[]->
}`;
export const LISTED_PRODUCTS_QUERY = `*[_type == "product" && status == "listed"] | order(order asc, name asc){...,
  "id": _id, "category": category-> { "id": _id, name, "slug": slug.current, description, image, order },
  "slug": slug.current
}`;
export const PRODUCT_BY_SLUG_QUERY = `*[_type == "product" && slug.current == $slug][0]{...,
  "id": _id, "category": category-> { "id": _id, name, "slug": slug.current, description, image, order },
  "slug": slug.current
}`;
